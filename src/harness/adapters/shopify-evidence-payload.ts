/**
 * Builds the DURABLE mission-event payload for a Shopify storefront result.
 *
 * ---------------------------------------------------------------------------
 * Why this exists: display is not caching
 * ---------------------------------------------------------------------------
 *
 * Shopify's catalog usage guidelines say, without qualification:
 *
 *     "Don't cache search results: Catalog results reflect merchant preferences
 *      on pricing, availability, and presentation. Caching results isn't
 *      allowed."
 *
 * BE-10 originally persisted a 4 KB excerpt of each result as an
 * `evidence.recorded` event, on the argument that a timestamped provenance
 * record is not a cache. That question was escalated rather than assumed, and
 * the ruling took the strict reading.
 *
 * So the boundary is drawn here, and it is sharp:
 *
 *   TRANSIENT (allowed)  — the 4 KB excerpt travels in the HTTP response and is
 *                          rendered in the canvas for the person looking at it
 *                          right now. It is never written anywhere.
 *
 *   DURABLE (this file)  — what reaches the database is only the sha-256 digest,
 *                          byte counts, and structured `refs`: opaque Shopify
 *                          GIDs and the cart handoff URL. No catalog text. No
 *                          titles, descriptions, prices, availability, or image
 *                          URLs. Nothing a reader could reconstruct a listing
 *                          from, and nothing that could serve a later query.
 *
 * The digest still makes the observation auditable: anyone holding the original
 * payload can prove it is what Cardea saw, without Cardea retaining the text.
 *
 * `input` is retained deliberately — it is Cardea's own request (the user's
 * query, a product id), not merchant catalog content.
 *
 * This module is intentionally dependency-free and side-effect-free: it is
 * imported by a client component, so it must not reach for `process.env`,
 * `server-only`, or anything else that cannot cross the bundle boundary.
 */

/** Bounded opaque identifiers. Ids and one URL — never prices, copy, or imagery. */
export type ShopifyEvidenceRefs = {
  productIds: string[];
  variantIds: string[];
  cartId: string | null;
  lineIds: string[];
  continueUrl: string | null;
};

/**
 * The payload committed to `evidence.recorded`.
 *
 * Note what is absent by construction: there is no `excerpt` field, so no code
 * path can persist catalog text even by mistake.
 */
export type ShopifyDurableEvidencePayload = {
  source: "capability.shopify";
  origin: string;
  toolName: string;
  readOnly: boolean;
  input: Record<string, unknown>;
  digest: string;
  digestAlgorithm: "sha-256";
  /** Size of the full upstream payload, before any capping. */
  resultBytes: number;
  /** Size of the excerpt that was shown transiently but deliberately not stored. */
  displayedExcerptBytes: number;
  truncated: boolean;
  /** Stated plainly so a reader of the mission log knows why there is no text. */
  excerptWithheld: "shopify_no_cache_policy";
  refs: ShopifyEvidenceRefs;
  capturedAt: string;
  durationMs: number;
};

const EMPTY_REFS: ShopifyEvidenceRefs = {
  productIds: [],
  variantIds: [],
  cartId: null,
  lineIds: [],
  continueUrl: null,
};

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, cap);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Re-narrows refs defensively; the API response is re-validated, never trusted by shape. */
export function normalizeShopifyRefs(value: unknown): ShopifyEvidenceRefs {
  if (!value || typeof value !== "object") return EMPTY_REFS;
  const record = value as Record<string, unknown>;
  return {
    productIds: stringList(record.productIds, 25),
    variantIds: stringList(record.variantIds, 25),
    cartId: nullableString(record.cartId),
    lineIds: stringList(record.lineIds, 25),
    continueUrl: nullableString(record.continueUrl),
  };
}

export function buildShopifyDurableEvidencePayload(options: {
  origin: string;
  capabilityId: string;
  tool: string;
  readOnly: boolean;
  input: Record<string, unknown>;
  digestSha256: string;
  resultBytes: number;
  excerpt: string;
  truncated: boolean;
  refs: unknown;
  capturedAt: string;
  durationMs?: number;
}): ShopifyDurableEvidencePayload {
  return {
    source: "capability.shopify",
    origin: options.origin,
    toolName: `${options.capabilityId} (${options.tool})`,
    readOnly: options.readOnly,
    input: options.input,
    digest: options.digestSha256,
    digestAlgorithm: "sha-256",
    resultBytes: options.resultBytes,
    // The excerpt is measured, then dropped. Only its size survives.
    displayedExcerptBytes: options.excerpt.length,
    truncated: options.truncated,
    excerptWithheld: "shopify_no_cache_policy",
    refs: normalizeShopifyRefs(options.refs),
    capturedAt: options.capturedAt,
    durationMs: options.durationMs ?? 0,
  };
}

/** Capability ids whose results are reads rather than cart writes. */
export function isShopifyReadOnlyCapability(capabilityId: string): boolean {
  return (
    capabilityId === "shopify.catalog_search" ||
    capabilityId === "shopify.product_details" ||
    capabilityId === "shopify.cart_read"
  );
}
