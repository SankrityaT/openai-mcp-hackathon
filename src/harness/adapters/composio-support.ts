/**
 * Dependency-free helpers for the Composio adapter: signed OAuth state
 * tokens, untrusted-evidence shaping, and an in-memory circuit breaker.
 *
 * Deliberately has no `@composio/*` or `"server-only"` import so it stays
 * unit-testable under plain `node:test`; `composio.ts` is the server-only
 * orchestration layer that calls into this module.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
    | "toolkit_not_allowed"
    | "nonce_mismatch";

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
  missionId?: string;
  nodeId?: string;
  iat: number;
  /** Single-use nonce; see {@link generateComposioStateNonce}. */
  nonce: string;
};

const NONCE_HEX_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Double-submit single-use nonce cookie name for the Composio OAuth state
 * (see {@link generateComposioStateNonce}). Scoped by the authorize route to
 * the callback route's path only, HttpOnly, short-lived (matches
 * `STATE_TTL_MS`), and cleared by the callback route immediately after it is
 * read — so a leaked or replayed `state` token is unusable once the real
 * callback has fired. Lives here (not in a `route.ts`) because Next.js route
 * handler modules may only export HTTP method handlers and a small fixed set
 * of route-segment-config values.
 */
export const COMPOSIO_OAUTH_NONCE_COOKIE = "cardea_composio_oauth_nonce";
export const COMPOSIO_OAUTH_NONCE_COOKIE_MAX_AGE_SECONDS = STATE_TTL_MS / 1000;

/**
 * Generates a random single-use nonce for the OAuth state double-submit
 * pattern: the caller embeds this in the signed state (via
 * {@link signComposioState}) *and* stores the same raw value in a short-lived
 * HttpOnly cookie scoped to the callback route. The callback then requires
 * both to match (see `expected.nonce` in {@link verifyComposioState}) and the
 * route clears the cookie immediately after reading it, so a leaked/replayed
 * `state` token is worthless once the legitimate callback has consumed it —
 * without needing a durable nonce store or a new table.
 */
export function generateComposioStateNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Signs `{userId, toolkit, sessionId, nonce, iat}` with HMAC-SHA256 over a server secret. */
export function signComposioState(
  input: {
    userId: string;
    toolkit: ComposioToolkit;
    sessionId: string;
    nonce: string;
    missionId?: string;
    nodeId?: string;
  },
  secret: string,
  now = Date.now(),
): string {
  const payload: ComposioStatePayload = {
    userId: input.userId,
    toolkit: input.toolkit,
    sessionId: input.sessionId,
    nonce: input.nonce,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    iat: now,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verifies signature, expiry, user binding, and the single-use nonce.
 * Throws {@link ComposioStateError} on any failure so callers can redirect to
 * a visible error state without ever trusting an unsigned, cross-user, or
 * replayed token.
 *
 * `expected.nonce` must be the raw value read from the callback-scoped
 * HttpOnly cookie set at authorize time (see {@link generateComposioStateNonce}).
 * A missing cookie (e.g. the callback is hit directly, or a `state` is
 * replayed after the legitimate callback already consumed its cookie) must
 * be passed as an empty string by the caller, which never matches a valid
 * nonce and so always fails closed.
 */
export function verifyComposioState(
  token: string,
  expected: { userId: string; nonce: string },
  secret: string,
  now = Date.now(),
): {
  toolkit: ComposioToolkit;
  sessionId: string;
  missionId?: string;
  nodeId?: string;
} {
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
  if (
    (payload.missionId !== undefined &&
      (typeof payload.missionId !== "string" || payload.missionId.length > 120)) ||
    (payload.nodeId !== undefined &&
      (typeof payload.nodeId !== "string" || payload.nodeId.length > 120))
  ) {
    throw new ComposioStateError("malformed");
  }
  if (typeof payload.nonce !== "string" || !NONCE_HEX_PATTERN.test(payload.nonce)) {
    throw new ComposioStateError("malformed");
  }
  const providedNonce = Buffer.from(payload.nonce, "utf8");
  const expectedNonce = Buffer.from(
    NONCE_HEX_PATTERN.test(expected.nonce) ? expected.nonce : "\0".repeat(providedNonce.length),
    "utf8",
  );
  if (
    providedNonce.length !== expectedNonce.length ||
    !timingSafeEqual(providedNonce, expectedNonce)
  ) {
    throw new ComposioStateError("nonce_mismatch");
  }
  return {
    toolkit: payload.toolkit,
    sessionId: payload.sessionId,
    ...(payload.missionId ? { missionId: payload.missionId } : {}),
    ...(payload.nodeId ? { nodeId: payload.nodeId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared untrusted-evidence content sanitization
//
// Applies to every adapter's transient, model/human-facing excerpt (this
// file's Composio excerpt, and Shopify's — see `sanitizeEvidenceExcerptText`
// used from `shopify-capability.ts`, which only has the already-serialized
// excerpt string available, not the original object).
//
// Deliberately a small, well-documented allowlist-of-*shape*, not an arms
// race of injection regexes: the real defense is trust-zone separation
// (ARCHITECTURE.md "Prompt-injection and trust boundaries" — untrusted
// evidence never becomes an instruction, regardless of what its text says).
// This only prevents the most common vector — a field whose *name* declares
// itself as directive text (Shopify's storefront `instructions` field is the
// documented example: "Assist them in navigating to checkout") — from
// surviving verbatim into an excerpt a model or human might read, plus a
// short defang pass for a handful of classic imperative-injection idioms.
//
// The digest (provenance) is always computed over the ORIGINAL, unsanitized
// payload, before any of this runs — sanitization only ever touches the
// excerpt, never the digest input.
// ---------------------------------------------------------------------------

/** JSON field names known to carry agent-directive text in third-party API responses. */
const INSTRUCTION_BEARING_FIELD_NAMES = new Set([
  "instructions",
  "instruction",
  "directive",
  "directives",
  "system_prompt",
  "systemprompt",
  "agent_instructions",
  "prompt",
]);

const NEUTRALIZED_FIELD_PLACEHOLDER = "[neutralized: instruction-bearing field withheld]";

/** A short, fixed set of imperative-injection phrasings to defang in remaining free text. */
const IMPERATIVE_INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior|the above)\s+instructions?/gi,
  /disregard (all|any|previous|prior|the above)/gi,
  /you (are|must|should) now (act|behave|respond)/gi,
  /new instructions?\s*:/gi,
  /system\s*prompt\s*:/gi,
];

function defangImperativeText(text: string): { text: string; matched: boolean } {
  let matched = false;
  let result = text;
  for (const pattern of IMPERATIVE_INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      matched = true;
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => `[neutralized: "${match.trim()}"]`);
    }
  }
  return { text: result, matched };
}

const MAX_SANITIZE_DEPTH = 6;

/**
 * Recursively strips known instruction-bearing fields from a parsed evidence
 * object and defangs imperative-injection phrasing in the remaining string
 * values. Returns a NEW value; never mutates the input, and never touches
 * whatever value was used to compute a digest (call this only when building
 * the excerpt, after the digest is already computed over the original).
 */
export function sanitizeEvidenceValue(
  value: unknown,
  neutralizedFields: string[] = [],
  depth = 0,
  path = "",
): { value: unknown; neutralizedFields: string[] } {
  if (depth > MAX_SANITIZE_DEPTH) return { value, neutralizedFields };
  if (typeof value === "string") {
    const { text, matched } = defangImperativeText(value);
    if (matched) neutralizedFields.push(path || "(root)");
    return { value: text, neutralizedFields };
  }
  if (Array.isArray(value)) {
    const mapped = value.map(
      (entry, index) =>
        sanitizeEvidenceValue(entry, neutralizedFields, depth + 1, `${path}[${index}]`).value,
    );
    return { value: mapped, neutralizedFields };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (INSTRUCTION_BEARING_FIELD_NAMES.has(key.toLowerCase())) {
        result[key] = NEUTRALIZED_FIELD_PLACEHOLDER;
        neutralizedFields.push(fieldPath);
        continue;
      }
      result[key] = sanitizeEvidenceValue(entry, neutralizedFields, depth + 1, fieldPath).value;
    }
    return { value: result, neutralizedFields };
  }
  return { value, neutralizedFields };
}

/**
 * String-based counterpart for adapters that only have the already-serialized
 * (and possibly byte-truncated) excerpt text available, not the original
 * object — e.g. Shopify, whose evidence builder lives outside this harness's
 * ownership boundary and hands back a finished excerpt string. Strips
 * `"instructions": "..."`-shaped fields via regex and defangs the same
 * imperative phrasing. Best-effort: a mid-field truncation can leave a
 * dangling quote, which is intentionally over-neutralized (the whole
 * remainder of the string is replaced) rather than left ambiguous.
 */
export function sanitizeEvidenceExcerptText(excerpt: string): {
  text: string;
  neutralizedFields: string[];
} {
  const neutralizedFields: string[] = [];
  let text = excerpt;
  for (const field of INSTRUCTION_BEARING_FIELD_NAMES) {
    const pattern = new RegExp(`"${field}"\\s*:\\s*"[^"]*"?`, "gi");
    if (pattern.test(text)) {
      neutralizedFields.push(field);
    }
    pattern.lastIndex = 0;
    text = text.replace(pattern, `"${field}":"${NEUTRALIZED_FIELD_PLACEHOLDER}"`);
  }
  const { text: defanged, matched } = defangImperativeText(text);
  if (matched) neutralizedFields.push("(free-text)");
  return { text: defanged, neutralizedFields };
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
  /** True when `excerpt` diverges from the raw payload because a field was neutralized. */
  sanitized: boolean;
  /** Field paths (or "(free-text)") that were neutralized; empty when nothing was. */
  neutralizedFields: string[];
};

/**
 * Converts a raw tool result into bounded, provenance-tagged, untrusted
 * evidence: origin, sha-256 digest of the full ORIGINAL payload, and a
 * byte-capped excerpt built from the SANITIZED payload (see
 * `sanitizeEvidenceValue` above — the digest never sees the sanitized form,
 * preserving provenance over what Composio actually returned). Never returns
 * a full raw connector payload.
 */
export function buildComposioEvidence(
  tool: string,
  data: Record<string, unknown> | null | undefined,
  now = new Date(),
): ComposioEvidence {
  const original = data ?? {};
  const buffer = Buffer.from(JSON.stringify(original), "utf8");
  const digestSha256 = createHash("sha256").update(buffer).digest("hex");
  const { value: sanitizedValue, neutralizedFields } = sanitizeEvidenceValue(original);
  const sanitizedBuffer = Buffer.from(JSON.stringify(sanitizedValue), "utf8");
  const excerpt = sanitizedBuffer.subarray(0, COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP).toString("utf8");
  return {
    origin: `composio:${tool}`,
    provider: "composio",
    toolSlug: tool,
    digestSha256,
    excerpt,
    bytes: buffer.byteLength,
    trust: "untrusted",
    capturedAt: now.toISOString(),
    sanitized: neutralizedFields.length > 0,
    neutralizedFields,
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
