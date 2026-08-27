/**
 * Dependency-free helpers for the Composio adapter: signed OAuth state
 * tokens, untrusted-evidence shaping, and an in-memory circuit breaker.
 *
 * Deliberately has no `@composio/*` or `"server-only"` import so it stays
 * unit-testable under plain `node:test`; `composio.ts` is the server-only
 * orchestration layer that calls into this module.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COMPOSIO_ALLOWED_TOOLKITS = ["gmail", "googlecalendar"] as const;
export type ComposioToolkit = (typeof COMPOSIO_ALLOWED_TOOLKITS)[number];

export function isComposioToolkit(value: string): value is ComposioToolkit {
  return (COMPOSIO_ALLOWED_TOOLKITS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Signed OAuth state (authorize -> callback round trip)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000;

export class ComposioStateError extends Error {
  readonly reason:
    | "not_configured"
    | "malformed"
    | "invalid_signature"
    | "expired"
    | "user_mismatch"
    | "toolkit_not_allowed";

  constructor(reason: ComposioStateError["reason"]) {
    super(`Composio OAuth state is invalid: ${reason}`);
    this.name = "ComposioStateError";
    this.reason = reason;
  }
}

type ComposioStatePayload = {
  userId: string;
  toolkit: string;
  sessionId: string;
  iat: number;
};

/** Signs `{userId, toolkit, sessionId, iat}` with HMAC-SHA256 over a server secret. */
export function signComposioState(
  input: { userId: string; toolkit: ComposioToolkit; sessionId: string },
  secret: string,
  now = Date.now(),
): string {
  const payload: ComposioStatePayload = {
    userId: input.userId,
    toolkit: input.toolkit,
    sessionId: input.sessionId,
    iat: now,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verifies signature, expiry, and user binding. Throws {@link ComposioStateError}
 * on any failure so callers can redirect to a visible error state without
 * ever trusting an unsigned or cross-user token.
 */
export function verifyComposioState(
  token: string,
  expected: { userId: string },
  secret: string,
  now = Date.now(),
): { toolkit: ComposioToolkit; sessionId: string } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ComposioStateError("malformed");
  }
  const [encoded, signature] = parts;
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest("base64url");
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expectedSignature);
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new ComposioStateError("invalid_signature");
  }
  let payload: ComposioStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ComposioStatePayload;
  } catch {
    throw new ComposioStateError("malformed");
  }
  if (typeof payload.iat !== "number" || now - payload.iat > STATE_TTL_MS || now < payload.iat) {
    throw new ComposioStateError("expired");
  }
  if (typeof payload.userId !== "string" || payload.userId !== expected.userId) {
    throw new ComposioStateError("user_mismatch");
  }
  if (typeof payload.toolkit !== "string" || !isComposioToolkit(payload.toolkit)) {
    throw new ComposioStateError("toolkit_not_allowed");
  }
  if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
    throw new ComposioStateError("malformed");
  }
  return { toolkit: payload.toolkit, sessionId: payload.sessionId };
}

// ---------------------------------------------------------------------------
// Untrusted-evidence shaping
// ---------------------------------------------------------------------------

export const COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP = 4_000;

export type ComposioEvidence = {
  origin: string;
  provider: "composio";
  toolSlug: string;
  digestSha256: string;
  excerpt: string;
  bytes: number;
  trust: "untrusted";
  capturedAt: string;
};

/**
 * Converts a raw tool result into bounded, provenance-tagged, untrusted
 * evidence: origin, sha-256 digest of the full payload, and a byte-capped
 * excerpt. Never returns a full raw connector payload.
 */
export function buildComposioEvidence(
  tool: string,
  data: Record<string, unknown> | null | undefined,
  now = new Date(),
): ComposioEvidence {
  const serialized = JSON.stringify(data ?? {});
  const buffer = Buffer.from(serialized, "utf8");
  const digestSha256 = createHash("sha256").update(buffer).digest("hex");
  const excerpt = buffer.subarray(0, COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP).toString("utf8");
  return {
    origin: `composio:${tool}`,
    provider: "composio",
    toolSlug: tool,
    digestSha256,
    excerpt,
    bytes: buffer.byteLength,
    trust: "untrusted",
    capturedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// In-memory circuit breaker + retry policy
// ---------------------------------------------------------------------------

const FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

type CircuitState = { failures: number; openUntil: number };

export class ComposioCircuitOpenError extends Error {
  constructor(tool: string) {
    super(`Composio tool "${tool}" is temporarily circuit-broken after repeated failures.`);
    this.name = "ComposioCircuitOpenError";
  }
}

export function createCircuitBreakerStore() {
  const breakers = new Map<string, CircuitState>();
  return {
    isOpen(key: string, now = Date.now()): boolean {
      const state = breakers.get(key);
      return !!state && state.openUntil > now;
    },
    recordFailure(key: string, now = Date.now()): void {
      const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
      state.failures += 1;
      if (state.failures >= FAILURE_THRESHOLD) {
        state.openUntil = now + CIRCUIT_OPEN_MS;
      }
      breakers.set(key, state);
    },
    recordSuccess(key: string): void {
      breakers.set(key, { failures: 0, openUntil: 0 });
    },
  };
}
export type ComposioCircuitBreakerStore = ReturnType<typeof createCircuitBreakerStore>;

/** Conservative retryable-failure classifier: timeouts, resets, 5xx, and rate limits. */
export function isRetryableComposioFailure(message: string): boolean {
  return /timeout|timed[ -]?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|\b5\d\d\b|rate.?limit|429/i.test(
    message,
  );
}

export function computeComposioBackoffMs(attempt: number, baseMs = 200, capMs = 2_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * (exponential / 2));
  return exponential - jitter;
}
