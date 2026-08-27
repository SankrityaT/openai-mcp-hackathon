import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShopifyDurableEvidencePayload,
  isShopifyReadOnlyCapability,
  normalizeShopifyRefs,
} from "./shopify-evidence-payload";

/**
 * A realistic storefront result. Every string in `CATALOG_TEXT` is merchant
 * content that Shopify forbids caching, so none of it may appear in anything
 * this module produces.
 */
const CATALOG_TEXT = [
  "Women's Wool Runner - Natural Black (Black Sole)",
  "The Allbirds Wool Runner is the original wool sneaker",
  "110.0",
  "cdn.shopify.com/s/files/1/1104/4168/files/Allbirds_WL_RN.png",
  "available",
];

const EXCERPT = JSON.stringify({
  products: [
    {
      id: "gid://shopify/Product/1878275686469",
      title: CATALOG_TEXT[0],
      description: { html: CATALOG_TEXT[1] },
      price_range: { min: { amount: 11000, currency: "USD" } },
      media: [{ url: `https://${CATALOG_TEXT[3]}` }],
      variants: [{ id: "gid://shopify/ProductVariant/32262292013136", availability: { available: true } }],
    },
  ],
});

function buildPayload(overrides: Record<string, unknown> = {}) {
  return buildShopifyDurableEvidencePayload({
    origin: "https://allbirds.com",
    capabilityId: "shopify.catalog_search",
    tool: "search_catalog",
    readOnly: true,
    input: { query: "wool runner", limit: 2 },
    digestSha256: "d39530feb860789613434af708c79963881bb62033e8ded58a58aaed7e8f4e5b",
    resultBytes: 13523,
    excerpt: EXCERPT,
    truncated: true,
    refs: {
      productIds: ["gid://shopify/Product/1878275686469"],
      variantIds: ["gid://shopify/ProductVariant/32262292013136"],
      cartId: null,
      lineIds: [],
      continueUrl: null,
    },
    capturedAt: "2026-08-27T12:00:00.000Z",
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* The ruling: no catalog text may ever be persisted                          */
/* -------------------------------------------------------------------------- */

test("the durable payload has no excerpt field at all", () => {
  const payload = buildPayload();
  assert.equal("excerpt" in payload, false);
  assert.equal(Object.keys(payload).includes("excerpt"), false);
});

test("no merchant catalog text survives into the durable payload", () => {
  // The load-bearing regression test. Shopify: "Caching results isn't allowed."
  const serialized = JSON.stringify(buildPayload());
  for (const text of CATALOG_TEXT) {
    assert.equal(
      serialized.includes(text),
      false,
      `persisted payload must not contain catalog text: ${text}`,
    );
  }
});

test("a payload carrying the excerpt would fail this suite", () => {
  // Guards the guard: proves the assertion above can actually fail, so it is
  // not silently vacuous if the payload shape changes.
  const leaky = { ...buildPayload(), excerpt: EXCERPT } as Record<string, unknown>;
  const serialized = JSON.stringify(leaky);
  assert.equal(
    CATALOG_TEXT.some((text) => serialized.includes(text)),
    true,
    "the catalog-text detector must be capable of detecting a leak",
  );
});

test("persists exactly the allowed fields: digest, byte counts, and refs", () => {
  const payload = buildPayload();
  assert.deepEqual(Object.keys(payload).sort(), [
    "capturedAt",
    "digest",
    "digestAlgorithm",
    "displayedExcerptBytes",
    "durationMs",
    "excerptWithheld",
    "input",
    "origin",
    "readOnly",
    "refs",
    "resultBytes",
    "source",
    "toolName",
    "truncated",
  ]);
  assert.equal(payload.source, "capability.shopify");
  assert.equal(payload.digestAlgorithm, "sha-256");
  assert.equal(payload.digest.length, 64);
  assert.equal(payload.resultBytes, 13523);
  assert.equal(payload.displayedExcerptBytes, EXCERPT.length);
  assert.equal(payload.truncated, true);
  assert.equal(payload.excerptWithheld, "shopify_no_cache_policy");
});

test("keeps the digest so the observation stays auditable without the text", () => {
  const payload = buildPayload();
  assert.equal(payload.digest, "d39530feb860789613434af708c79963881bb62033e8ded58a58aaed7e8f4e5b");
});

test("retains Cardea's own input, which is a request and not merchant content", () => {
  const payload = buildPayload();
  assert.deepEqual(payload.input, { query: "wool runner", limit: 2 });
});

/* -------------------------------------------------------------------------- */
/* Refs                                                                       */
/* -------------------------------------------------------------------------- */

test("carries the opaque ids needed to chain a later call", () => {
  const payload = buildPayload({
    refs: {
      productIds: ["gid://shopify/Product/1"],
      variantIds: ["gid://shopify/ProductVariant/2"],
      cartId: "gid://shopify/Cart/abc?key=1",
      lineIds: ["gid://shopify/CartLine/line-1"],
      continueUrl: "https://store.example/cart/c/abc",
    },
  });
  assert.deepEqual(payload.refs, {
    productIds: ["gid://shopify/Product/1"],
    variantIds: ["gid://shopify/ProductVariant/2"],
    cartId: "gid://shopify/Cart/abc?key=1",
    lineIds: ["gid://shopify/CartLine/line-1"],
    continueUrl: "https://store.example/cart/c/abc",
  });
});

test("re-narrows a malformed or hostile refs object instead of trusting it", () => {
  const payload = buildPayload({
    refs: {
      productIds: ["gid://shopify/Product/1", 42, null, { nested: true }],
      variantIds: "not-an-array",
      cartId: 99,
      lineIds: undefined,
      continueUrl: "",
      // An attempt to smuggle catalog text through the refs channel.
      title: CATALOG_TEXT[0],
      description: CATALOG_TEXT[1],
    },
  });
  assert.deepEqual(payload.refs.productIds, ["gid://shopify/Product/1"]);
  assert.deepEqual(payload.refs.variantIds, []);
  assert.equal(payload.refs.cartId, null);
  assert.deepEqual(payload.refs.lineIds, []);
  assert.equal(payload.refs.continueUrl, null);
  // The smuggled keys are dropped by re-narrowing, not merely ignored.
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(CATALOG_TEXT[0]), false);
  assert.equal(serialized.includes(CATALOG_TEXT[1]), false);
});

test("caps id lists so one result cannot bloat the mission log", () => {
  const payload = buildPayload({
    refs: { productIds: Array.from({ length: 200 }, (_, index) => `gid://shopify/Product/${index}`) },
  });
  assert.equal(payload.refs.productIds.length, 25);
});

test("tolerates absent or non-object refs", () => {
  for (const refs of [undefined, null, "refs", 7, []]) {
    const payload = buildPayload({ refs });
    assert.deepEqual(payload.refs.productIds, []);
    assert.equal(payload.refs.cartId, null);
  }
  assert.deepEqual(normalizeShopifyRefs(undefined).lineIds, []);
});

/* -------------------------------------------------------------------------- */
/* Read/write classification                                                  */
/* -------------------------------------------------------------------------- */

test("classifies reads and cart writes correctly", () => {
  assert.equal(isShopifyReadOnlyCapability("shopify.catalog_search"), true);
  assert.equal(isShopifyReadOnlyCapability("shopify.product_details"), true);
  assert.equal(isShopifyReadOnlyCapability("shopify.cart_read"), true);
  assert.equal(isShopifyReadOnlyCapability("shopify.cart_prepare"), false);
  assert.equal(isShopifyReadOnlyCapability("shopify.cart_update"), false);
});

test("a cart write is recorded as a write in the mission log", () => {
  const payload = buildPayload({
    capabilityId: "shopify.cart_prepare",
    tool: "create_cart",
    readOnly: isShopifyReadOnlyCapability("shopify.cart_prepare"),
  });
  assert.equal(payload.readOnly, false);
  assert.equal(payload.toolName, "shopify.cart_prepare (create_cart)");
});
