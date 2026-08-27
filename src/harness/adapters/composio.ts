import "server-only";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import {
  buildComposioEvidence,
  ComposioCircuitOpenError,
  COMPOSIO_ALLOWED_TOOLKITS,
  createCircuitBreakerStore,
  computeComposioBackoffMs,
  isRetryableComposioFailure,
  signComposioState,
  verifyComposioState,
  type ComposioEvidence,
  type ComposioToolkit,
} from "./composio-support";

export { COMPOSIO_ALLOWED_TOOLKITS, ComposioStateError, isComposioToolkit } from "./composio-support";
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
 * Deliberately excludes GMAIL_CREATE_EMAIL_DRAFT and any other write:
 * this slice is read-only only; sends/writes must go through harness
 * policy + approval, not this adapter.
 */
export const COMPOSIO_READ_ONLY_TOOLS = [
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_FIND_FREE_SLOTS",
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
] as const;
const readOnlyToolSet = new Set<string>(COMPOSIO_READ_ONLY_TOOLS);

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
  const [tools, toolkits] = await Promise.all([session.tools(), session.toolkits({ limit: 20 })]);
  return {
    available: true as const,
    sessionId: session.sessionId,
    tools,
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
 * short-lived state token binding the exact user, toolkit, and session,
 * embeds it in the callback URL, then starts the OAuth flow. Nothing about
 * the connected account or provider token ever reaches the browser — only
 * the provider's `redirectUrl` is returned.
 */
export async function initiateComposioAuthorization(input: {
  userId: string;
  toolkit: ComposioToolkit;
  callbackBaseUrl: string;
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
  const state = signComposioState(
    { userId: input.userId, toolkit: input.toolkit, sessionId: session.sessionId },
    secret,
  );
  const callbackUrl = new URL(input.callbackBaseUrl);
  callbackUrl.searchParams.set("state", state);
  const request = await session.authorize(input.toolkit, { callbackUrl: callbackUrl.toString() });
  return { available: true as const, redirectUrl: request.redirectUrl };
}

/**
 * Verifies the signed callback state (expiry + exact-user binding) and
 * confirms the resulting connection status through Composio. Never
 * persists or echoes a provider token; the caller decides what bounded,
 * non-secret reference (if any) to keep.
 */
export async function completeComposioAuthorization(input: { userId: string; state: string }) {
  const secret = stateSecret();
  if (!secret) return { available: false as const, reason: "not_configured" as const };
  const { toolkit, sessionId } = verifyComposioState(input.state, { userId: input.userId }, secret);
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.use(sessionId);
  const toolkits = await session.toolkits({ toolkits: [toolkit], limit: 1 });
  const match = toolkits.items.find((item) => item.slug === toolkit);
  return {
    available: true as const,
    toolkit,
    connected: match?.connection?.isActive ?? false,
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
  const session = await composio.sessions.create(userId, {
    toolkits: [...allowedToolkits],
    tags: ["readOnlyHint"],
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
 * Executes exactly one allowlisted read-only Composio tool with a hard
 * timeout, bounded retries for retryable failures only, and a simple
 * in-memory circuit breaker per tool slug. Converts the result into the
 * bounded untrusted-evidence shape — never a raw connector payload.
 *
 * Consequential sends/writes are out of scope for this slice: they must be
 * routed through the harness's deterministic policy + approval gate, not
 * executed directly here.
 */
export async function executeComposioTool(
  request: { userId: string; tool: string; input: Record<string, unknown>; timeoutMs?: number },
  deps: { executor?: ComposioToolExecutor } = {},
): Promise<ComposioExecutionResult> {
  if (!readOnlyToolSet.has(request.tool)) {
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

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
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
        if (retryable && attempt < MAX_RETRIES) {
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
      if (timedOut && attempt < MAX_RETRIES) {
        await delay(computeComposioBackoffMs(attempt));
        continue;
      }
      if (timedOut) {
        circuitBreaker.recordFailure(request.tool);
        return { available: false, reason: "timeout" };
      }
      if (isRetryableComposioFailure(message) && attempt < MAX_RETRIES) {
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
