// Field-level redaction for observability spans.
//
// The security contract (ARCHITECTURE.md "Observability") is absolute: an
// emitted span must NEVER carry secrets, OAuth tokens, full emails/documents,
// protected personal data, or raw hidden model reasoning. We enforce this with
// two independent layers so a mistake at a call site cannot leak:
//
//   1. An *allowlist* of attribute keys. Any key a span emitter did not
//      explicitly bless is dropped entirely before export — an attacker (or a
//      careless caller) cannot smuggle `authToken`/`email`/`prompt` through by
//      naming a new attribute, because unknown keys never survive.
//   2. Value *scrubbing* even for allowlisted keys. Long tokens, JWTs, API
//      keys, bearer credentials, and email addresses are replaced with a fixed
//      sentinel, and all strings are length-bounded. This defends the case
//      where a blessed key (e.g. `escalationReason`) is accidentally handed a
//      sensitive value.
//
// Only flat primitives are ever emitted; objects/arrays/functions collapse to
// the sentinel, so nested structures cannot carry a payload out.

export type SpanAttributeValue = string | number | boolean | null;
export type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

/**
 * Exact set of attribute keys permitted in an emitted span. Keys are opaque
 * identifiers, enums, and numeric metrics only — never free-form user content,
 * prompts, evidence, emails, or credentials. Extending observability means
 * adding a key here deliberately, which is the point: the allowlist is the
 * redaction boundary.
 */
export const ALLOWED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set<string>([
  // Correlation / topology (opaque UUIDs and enums, never PII)
  "stepName",
  "missionId",
  "nodeId",
  "tenantId",
  "provider",
  "capabilityId",
  // Model call
  "modelId",
  "modelTier",
  "reasoningEffort",
  "escalationReason",
  "estimatedInputTokens",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "costEstimateMicrounits",
  // Capability discovery / execution
  "capabilityCount",
  "requestedCount",
  "attempt",
  "retries",
  // Policy / approval (decision enums only — never the inputs)
  "decision",
  "policyCode",
  "escalationReasonCode",
  // Generic result
  "resultStatus",
]);

const MAX_STRING_LENGTH = 256;
const REDACTED = "[redacted]";

// Value-shape patterns that indicate a secret regardless of the attribute key.
// Deliberately broad: a false positive only over-redacts a metric label, which
// is harmless; a false negative could leak a credential, which is not.
const SECRET_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email address
  /sk-[A-Za-z0-9_-]{8,}/, // OpenAI-style API key
  /eyJ[A-Za-z0-9._-]{10,}/, // JWT (base64url header prefix)
  /bearer\s+[A-Za-z0-9._-]{8,}/i, // bearer token
  /[A-Fa-f0-9]{40,}/, // long hex (hashes, raw keys)
  /[A-Za-z0-9+/]{40,}={0,2}/, // long base64 blob
];

/**
 * Reduce a single attribute value to a redaction-safe primitive. Non-finite
 * numbers, non-primitive values, and secret-shaped strings never survive.
 */
export function redactValue(value: unknown): SpanAttributeValue {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) return REDACTED;
    }
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  // Objects, arrays, functions, bigint, symbol, undefined: never emitted.
  return REDACTED;
}

/**
 * Produce the export-safe attribute object: allowlisted keys only, each value
 * scrubbed. This is the single chokepoint every span passes through before it
 * leaves the process.
 */
export function redactAttributes(attributes: SpanAttributes | undefined): Record<string, SpanAttributeValue> {
  const out: Record<string, SpanAttributeValue> = {};
  if (!attributes || typeof attributes !== "object") return out;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key)) continue; // drop unknown keys wholesale
    out[key] = redactValue(value);
  }
  return out;
}
