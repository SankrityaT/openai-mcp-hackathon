import "server-only";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import {
  buildComposioEvidence,
  ComposioCircuitOpenError,
  COMPOSIO_ALLOWED_TOOLKITS,
  createCircuitBreakerStore,
  computeComposioBackoffMs,
  generateComposioStateNonce,
  isRetryableComposioFailure,
  signComposioState,
  verifyComposioState,
  type ComposioEvidence,
  type ComposioToolkit,
} from "./composio-support";

export {
  COMPOSIO_ALLOWED_TOOLKITS,
  COMPOSIO_OAUTH_NONCE_COOKIE,
  COMPOSIO_OAUTH_NONCE_COOKIE_MAX_AGE_SECONDS,
  ComposioStateError,
  isComposioToolkit,
} from "./composio-support";
export type { ComposioEvidence, ComposioToolkit } from "./composio-support";

const allowedToolkits = COMPOSIO_ALLOWED_TOOLKITS;

/**
 * MVP read-only tool allowlist for BE-05. These slugs are the demo-scoped
 * candidates named in docs/tickets/BE-05-composio.md ("read calendar
 * availability", "inspect one selected calendar window", "search a
 * dedicated demo mailbox", "read a selected message"). They must be
 * re-confirmed against the live Composio catalogue (an authenticated
 * COMPOSIO_API_KEY session) before the demo, per the ticket's explicit
 * "exact tools must be confirmed from the current Composio catalogue"
 * requirement — this environment has no reachable Composio credential.
 */
export const COMPOSIO_READ_ONLY_TOOLS = [
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_FIND_FREE_SLOTS",
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
] as const;
const readOnlyToolSet = new Set<string>(COMPOSIO_READ_ONLY_TOOLS);

/**
 * The only two write tools this adapter will execute. Reaching them requires
 * a `require_approval` decision the user has already accepted on the canvas:
 * `runExecuteNode` calls the registry solely after the policy engine allows
 * the action, and `DEFAULT_MISSION_AUTHORITY` admits both ids exclusively
 * through `approvalGatedCapabilityIds`. GMAIL_SEND_EMAIL and every other
 * send, delete, or permission change stays off this list and out of the
 * adapter. Slugs and argument names carry the same caveat as the read list:
 * they must be re-confirmed against the live Composio catalogue, which is
 * not reachable from this environment.
 */
export const COMPOSIO_APPROVAL_GATED_TOOLS = [
  "GOOGLECALENDAR_CREATE_EVENT",
  "GMAIL_CREATE_EMAIL_DRAFT",
] as const;
const approvalGatedToolSet = new Set<string>(COMPOSIO_APPROVAL_GATED_TOOLS);

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const CONNECTION_REQUIRED_PREFIX = "cardea_connection_required:";

const circuitBreaker = createCircuitBreakerStore();

function client() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  return new Composio({
    apiKey,
    provider: new VercelProvider({ strict: true }),
  });
}

export async function createComposioReadSession(userId: string) {
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.create(userId, {
    toolkits: [...allowedToolkits],
    tags: ["readOnlyHint"],
    manageConnections: true,
  });
  const toolkits = await session.toolkits({ limit: 20 });
  return {
    available: true as const,
    tools: [...COMPOSIO_READ_ONLY_TOOLS],
    toolkits: toolkits.items.map((toolkit) => ({
      slug: toolkit.slug,
      name: toolkit.name,
      connected: toolkit.connection?.isActive ?? false,
      logo: toolkit.logo,
    })),
  };
}

export async function authorizeComposioToolkit(input: {
  sessionId: string;
  toolkit: (typeof allowedToolkits)[number];
  callbackUrl: string;
}) {
  if (!allowedToolkits.includes(input.toolkit)) throw new Error("Toolkit is not allowed");
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.use(input.sessionId);
  const request = await session.authorize(input.toolkit, { callbackUrl: input.callbackUrl });
  return { available: true as const, redirectUrl: request.redirectUrl };
}

// ---------------------------------------------------------------------------
// BE-05 OAuth loop: authorize -> signed state -> callback confirmation
// ---------------------------------------------------------------------------

function stateSecret(): string | null {
  return process.env.CARDEA_STATE_SECRET || null;
}

/**
 * Creates a mission-scoped session restricted to one toolkit, signs a
 * short-lived state token binding the exact user, toolkit, session, and a
 * fresh single-use nonce, embeds the state in the callback URL, then starts
 * the OAuth flow. Nothing about the connected account or provider token ever
 * reaches the browser — only the provider's `redirectUrl` is returned.
 *
 * The returned `nonce` must be stored by the caller (the authorize route) in
 * a short-lived HttpOnly cookie scoped to the callback route, per the
 * double-submit single-use pattern documented on
 * {@link generateComposioStateNonce}. It is never sent to the client as part
 * of a JSON body.
 */
export async function initiateComposioAuthorization(input: {
  userId: string;
  toolkit: ComposioToolkit;
  callbackBaseUrl: string;
  missionId?: string;
  nodeId?: string;
}) {
  const secret = stateSecret();
  if (!secret) return { available: false as const, reason: "not_configured" as const };
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.create(input.userId, {
    toolkits: [input.toolkit],
    tags: ["readOnlyHint"],
    manageConnections: true,
  });
  const nonce = generateComposioStateNonce();
  const state = signComposioState(
    {
      userId: input.userId,
      toolkit: input.toolkit,
      sessionId: session.sessionId,
      nonce,
      missionId: input.missionId,
      nodeId: input.nodeId,
    },
    secret,
  );
  const callbackUrl = new URL(input.callbackBaseUrl);
  callbackUrl.searchParams.set("state", state);
  const request = await session.authorize(input.toolkit, { callbackUrl: callbackUrl.toString() });
  return { available: true as const, redirectUrl: request.redirectUrl, nonce };
}

/**
 * Verifies the signed callback state (expiry + exact-user binding + the
 * single-use nonce against `input.nonce`, which the caller must read from
 * the callback-scoped HttpOnly cookie and pass in as an empty string when
 * absent) and confirms the resulting connection status through Composio.
 * Never persists or echoes a provider token; the caller decides what
 * bounded, non-secret reference (if any) to keep.
 *
 * Tradeoff: the nonce cookie is the only single-use enforcement — there is
 * no durable/shared nonce store, so this is scoped to one browser and does
 * not protect against an attacker who can both intercept the `state`
 * *before* the legitimate callback fires *and* forge the victim's cookie
 * jar (a strictly harder bar than plain state replay, and out of scope for
 * this MVP; see docs/SECURITY_REVIEW_BE08.md).
 */
export async function completeComposioAuthorization(input: {
  userId: string;
  state: string;
  nonce: string;
}) {
  const secret = stateSecret();
  if (!secret) return { available: false as const, reason: "not_configured" as const };
  const { toolkit, sessionId, missionId, nodeId } = verifyComposioState(
    input.state,
    { userId: input.userId, nonce: input.nonce },
    secret,
  );
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.use(sessionId);
  const toolkits = await session.toolkits({ toolkits: [toolkit], limit: 1 });
  const match = toolkits.items.find((item) => item.slug === toolkit);
  return {
    available: true as const,
    toolkit,
    connected: match?.connection?.isActive ?? false,
    missionId,
    nodeId,
  };
}

// ---------------------------------------------------------------------------
// BE-05 execution path: one exact, read-only, timed, retried, circuit-broken tool
// ---------------------------------------------------------------------------

export type ComposioToolExecutor = (
  tool: string,
  toolInput: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<{ data: Record<string, unknown>; error: string | null }>;

async function executeViaComposioSdk(
  userId: string,
  tool: string,
  toolInput: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; error: string | null }> {
  const composio = client();
  if (!composio) throw new Error("not_configured");
  // The `readOnlyHint` tag filter is what keeps the read path unable to reach
  // a write tool at all. An approved write cannot carry that tag, so the
  // session for one is created without the filter — the allowlist above and
  // the policy engine's approval decision are what bound it instead.
  const session = await composio.sessions.create(userId, {
    toolkits: [...allowedToolkits],
    ...(approvalGatedToolSet.has(tool) ? {} : { tags: ["readOnlyHint"] }),
    manageConnections: true,
  });
  const toolkit = tool.startsWith("GMAIL_") ? "gmail" : "googlecalendar";
  const toolkits = await session.toolkits({ toolkits: [toolkit], limit: 1 });
  const connected = toolkits.items.some(
    (candidate) => candidate.slug === toolkit && candidate.connection?.isActive,
  );
  if (!connected) {
    return { data: {}, error: `${CONNECTION_REQUIRED_PREFIX}${toolkit}` };
  }
  const result = await session.execute(tool, toolInput);
  return { data: result.data, error: result.error };
}

export type ComposioExecutionResult =
  | { available: true; evidence: ComposioEvidence }
  | {
      available: false;
      reason:
        | "not_configured"
        | "tool_not_allowed"
        | "connection_required"
        | "circuit_open"
        | "timeout"
        | "provider_error";
      toolkit?: string;
    };

/**
 * Executes exactly one allowlisted Composio tool with a hard timeout,
 * bounded retries for retryable failures only, and a simple in-memory
 * circuit breaker per tool slug. Converts the result into the bounded
 * untrusted-evidence shape — never a raw connector payload.
 *
 * Two categories of tool are allowlisted, and nothing else:
 * `COMPOSIO_READ_ONLY_TOOLS`, and the two `COMPOSIO_APPROVAL_GATED_TOOLS`
 * writes that only ever arrive here after the deterministic policy engine
 * required an approval and the user accepted it. Sends, deletions, and
 * permission changes are absent from both lists.
 *
 * Retries are safe for a read. For a write they are bounded by the caller's
 * idempotency reservation in `runExecuteNode`, which reserves the key before
 * policy runs and completes it once, so a retried attempt cannot become a
 * second committed side effect.
 */
export async function executeComposioTool(
  request: { userId: string; tool: string; input: Record<string, unknown>; timeoutMs?: number },
  deps: { executor?: ComposioToolExecutor } = {},
): Promise<ComposioExecutionResult> {
  if (!readOnlyToolSet.has(request.tool) && !approvalGatedToolSet.has(request.tool)) {
    return { available: false, reason: "tool_not_allowed" };
  }
  if (circuitBreaker.isOpen(request.tool)) {
    return { available: false, reason: "circuit_open" };
  }
  if (!deps.executor && !process.env.COMPOSIO_API_KEY) {
    return { available: false, reason: "not_configured" };
  }
  const executor: ComposioToolExecutor =
    deps.executor ?? ((tool, toolInput) => executeViaComposioSdk(request.userId, tool, toolInput));
  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  // A read can be repeated safely. An approved write cannot: a timed-out
  // request may already have created the event or the draft at the provider,
  // and Composio gives this adapter no request-level idempotency key to
  // deduplicate against. So a write gets exactly one attempt, and a timeout
  // surfaces as a timeout for the user to resolve.
  const maxRetries = approvalGatedToolSet.has(request.tool) ? 0 : MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("composio_timeout")));
    });
    try {
      const result = await Promise.race([
        executor(request.tool, request.input, controller.signal),
        timeoutPromise,
      ]);
      clearTimeout(timer);
      if (result.error) {
        if (result.error.startsWith(CONNECTION_REQUIRED_PREFIX)) {
          return {
            available: false,
            reason: "connection_required",
            toolkit: result.error.slice(CONNECTION_REQUIRED_PREFIX.length),
          };
        }
        const retryable = isRetryableComposioFailure(result.error);
        if (retryable && attempt < maxRetries) {
          await delay(computeComposioBackoffMs(attempt));
          continue;
        }
        circuitBreaker.recordFailure(request.tool);
        return { available: false, reason: "provider_error" };
      }
      circuitBreaker.recordSuccess(request.tool);
      return { available: true, evidence: buildComposioEvidence(request.tool, result.data) };
    } catch (error) {
      clearTimeout(timer);
      const timedOut = controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      if (timedOut && attempt < maxRetries) {
        await delay(computeComposioBackoffMs(attempt));
        continue;
      }
      if (timedOut) {
        circuitBreaker.recordFailure(request.tool);
        return { available: false, reason: "timeout" };
      }
      if (isRetryableComposioFailure(message) && attempt < maxRetries) {
        await delay(computeComposioBackoffMs(attempt));
        continue;
      }
      circuitBreaker.recordFailure(request.tool);
      return { available: false, reason: "provider_error" };
    }
  }
  circuitBreaker.recordFailure(request.tool);
  return { available: false, reason: "provider_error" };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Re-exported for callers that only need the typed circuit-open error shape.
export { ComposioCircuitOpenError };
