/**
 * Pure request validation for `POST /api/integrations/shopify/execute`.
 *
 * Split out of `route.ts` deliberately. A Next.js route module transitively
 * imports `server-only` and the Supabase client, so it cannot be loaded under
 * plain `node --test`. Keeping the decision logic here — no I/O, no imports
 * beyond the capability id guard — means the rules that actually matter
 * (closed capability set, bounded strings, object-shaped input) are covered by
 * real tests instead of being asserted by hand.
 */
// Relative rather than the `@/` alias: this module is compiled by
// `tsconfig.harness-tests.json` for `node --test`, which emits CommonJS without
// rewriting path aliases. Every other tested module in the repo does the same.
import {
  isShopifyCapabilityId,
  type ShopifyCapabilityId,
} from "../../../../harness/adapters/shopify-capability";

/** Bounds every free-form identifier a client may influence. */
export const SHOPIFY_REQUEST_LIMITS = {
  maxMissionIdChars: 100,
  maxCorrelationIdChars: 100,
  maxIdempotencyKeyChars: 200,
  maxBodyBytes: 8 * 1024,
} as const;

export type ShopifyExecuteRejection =
  | "unknown_capability"
  | "input_must_be_object"
  | "body_must_be_object";

export type ShopifyExecuteCommand = {
  capabilityId: ShopifyCapabilityId;
  input: Record<string, unknown>;
  missionId?: string;
  correlationId?: string;
  idempotencyKey?: string;
};

export type ShopifyExecuteParse =
  | { ok: true; command: ShopifyExecuteCommand }
  | { ok: false; reason: ShopifyExecuteRejection };

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, max);
}

/**
 * Validates a decoded request body.
 *
 * The capability id is checked against the closed discovered set first, so a
 * caller can never name a Shopify checkout, payment, or order tool: those ids
 * do not exist in Cardea's vocabulary at all, and the check happens before any
 * configuration is read or any network call is considered.
 */
export function parseShopifyExecuteBody(body: unknown): ShopifyExecuteParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "body_must_be_object" };
  }
  const record = body as Record<string, unknown>;

  if (!isShopifyCapabilityId(record.capabilityId)) {
    return { ok: false, reason: "unknown_capability" };
  }

  const input = record.input;
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    return { ok: false, reason: "input_must_be_object" };
  }

  return {
    ok: true,
    command: {
      capabilityId: record.capabilityId,
      input: (input ?? {}) as Record<string, unknown>,
      missionId: boundedString(record.missionId, SHOPIFY_REQUEST_LIMITS.maxMissionIdChars),
      correlationId: boundedString(
        record.correlationId,
        SHOPIFY_REQUEST_LIMITS.maxCorrelationIdChars,
      ),
      idempotencyKey: boundedString(
        record.idempotencyKey,
        SHOPIFY_REQUEST_LIMITS.maxIdempotencyKeyChars,
      ),
    },
  };
}
