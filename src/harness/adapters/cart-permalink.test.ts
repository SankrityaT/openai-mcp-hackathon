import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityProviderError } from "../capability-errors";
import {
  CART_PERMALINK_CAPABILITY_ID,
  CART_PERMALINK_MAX_ITEMS,
  CART_PERMALINK_MAX_QUANTITY,
  CART_PERMALINK_ORIGIN,
  CART_PERMALINK_PROVIDER,
  CartPermalinkAdapter,
  composeCartPermalink,
  parseCartPermalinkInput,
} from "./cart-permalink";

function request(input: unknown, capabilityId = CART_PERMALINK_CAPABILITY_ID) {
  return {
    capabilityId,
    missionId: "mission-1",
    input: input as never,
    correlationId: "correlation-1",
    idempotencyKey: "idem-1",
  };
}

/* -------------------------------------------------------------------------- */
/* Descriptor                                                                 */
/* -------------------------------------------------------------------------- */

test("discovers exactly one read-only, low-risk capability on its own provider", async () => {
  const capabilities = await new CartPermalinkAdapter().discover();
  assert.equal(capabilities.length, 1);
  const [capability] = capabilities;
  assert.equal(capability.id, CART_PERMALINK_CAPABILITY_ID);
  assert.equal(capability.provider, CART_PERMALINK_PROVIDER);
  assert.equal(capability.name, CART_PERMALINK_CAPABILITY_ID);
  assert.equal(capability.readOnly, true);
  assert.equal(capability.risk.level, "low");
  assert.deepEqual(capability.risk.categories, ["read"]);
  assert.equal(capability.trust.level, "derived");
  assert.equal(capability.trust.origin, CART_PERMALINK_ORIGIN);
  // The planner needs to know when this applies and when it does not.
  assert.match(capability.description, /numeric variant ids/);
});

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

test("composes the documented Shopify permalink shape", () => {
  assert.equal(
    composeCartPermalink({ store: "example-store.com", items: [{ variantId: "123", quantity: 1 }] }),
    "https://example-store.com/cart/123:1",
  );
  assert.equal(
    composeCartPermalink({
      store: "example-store.com",
      items: [
        { variantId: "123", quantity: 2 },
        { variantId: "456", quantity: 3 },
      ],
    }),
    "https://example-store.com/cart/123:2,456:3",
  );
});

test("returns the url and a plain summary through the adapter", async () => {
  const result = await new CartPermalinkAdapter().execute(
    request({
      store: "Example-Store.com.",
      items: [
        { variantId: " 123 ", quantity: 2 },
        { variantId: 456, quantity: 1 },
      ],
    }),
  );
  assert.deepEqual(result.output, { url: "https://example-store.com/cart/123:2,456:1" });
  assert.equal(result.summary, "prepared a cart link at example-store.com with 2 items");
  assert.equal(result.provenance, CART_PERMALINK_ORIGIN);
  assert.equal(result.trust, "derived");
  assert.equal(result.executionId, "idem-1");
});

test("the composed url parses back to the store it was given", async () => {
  const result = await new CartPermalinkAdapter().execute(
    request({ store: "shop.example.co.uk", items: [{ variantId: "42", quantity: 10 }] }),
  );
  const url = new URL((result.output as { url: string }).url);
  assert.equal(url.origin, "https://shop.example.co.uk");
  assert.equal(url.pathname, "/cart/42:10");
  assert.equal(url.search, "");
});

/* -------------------------------------------------------------------------- */
/* Validation and bounds                                                      */
/* -------------------------------------------------------------------------- */

const rejected: [string, unknown][] = [
  ["a missing store", { items: [{ variantId: "1", quantity: 1 }] }],
  ["a store carrying a scheme", { store: "https://example.com", items: [{ variantId: "1", quantity: 1 }] }],
  ["a store carrying a path", { store: "example.com/cart", items: [{ variantId: "1", quantity: 1 }] }],
  ["a store carrying a port", { store: "example.com:443", items: [{ variantId: "1", quantity: 1 }] }],
  ["a store carrying credentials", { store: "user@example.com", items: [{ variantId: "1", quantity: 1 }] }],
  ["a bare label with no dot", { store: "localhost", items: [{ variantId: "1", quantity: 1 }] }],
  ["missing items", { store: "example.com" }],
  ["an empty item list", { store: "example.com", items: [] }],
  ["items that are not an array", { store: "example.com", items: { variantId: "1", quantity: 1 } }],
  [
    "more items than the ceiling",
    {
      store: "example.com",
      items: Array.from({ length: CART_PERMALINK_MAX_ITEMS + 1 }, () => ({
        variantId: "1",
        quantity: 1,
      })),
    },
  ],
  ["a global id instead of a numeric one", {
    store: "example.com",
    items: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 1 }],
  }],
  ["a variant id smuggling a delimiter", {
    store: "example.com",
    items: [{ variantId: "123:9,456", quantity: 1 }],
  }],
  ["a variant id smuggling a path", {
    store: "example.com",
    items: [{ variantId: "123/../admin", quantity: 1 }],
  }],
  ["a missing variant id", { store: "example.com", items: [{ quantity: 1 }] }],
  ["a zero quantity", { store: "example.com", items: [{ variantId: "1", quantity: 0 }] }],
  ["a negative quantity", { store: "example.com", items: [{ variantId: "1", quantity: -1 }] }],
  ["a fractional quantity", { store: "example.com", items: [{ variantId: "1", quantity: 1.5 }] }],
  [
    "a quantity above the ceiling",
    {
      store: "example.com",
      items: [{ variantId: "1", quantity: CART_PERMALINK_MAX_QUANTITY + 1 }],
    },
  ],
  ["a missing quantity", { store: "example.com", items: [{ variantId: "1" }] }],
];

for (const [label, input] of rejected) {
  test(`refuses ${label}`, () => {
    assert.throws(() => parseCartPermalinkInput(input));
  });
}

test("both bounds are inclusive at the edge", () => {
  const parsed = parseCartPermalinkInput({
    store: "example.com",
    items: Array.from({ length: CART_PERMALINK_MAX_ITEMS }, () => ({
      variantId: "7",
      quantity: CART_PERMALINK_MAX_QUANTITY,
    })),
  });
  assert.equal(parsed.items.length, CART_PERMALINK_MAX_ITEMS);
  assert.equal(parsed.items[0].quantity, CART_PERMALINK_MAX_QUANTITY);
});

test("invalid input surfaces as a provider error, never a composed url", async () => {
  await assert.rejects(
    new CartPermalinkAdapter().execute(request({ store: "https://example.com", items: [] })),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityProviderError);
      assert.equal(error.provider, CART_PERMALINK_PROVIDER);
      assert.match(error.reason, /^invalid_input/);
      return true;
    },
  );
});

test("refuses a capability id it does not own", async () => {
  await assert.rejects(
    new CartPermalinkAdapter().execute(
      request({ store: "example.com", items: [{ variantId: "1", quantity: 1 }] }, "shopify.cart_prepare"),
    ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityProviderError);
      assert.equal(error.reason, "tool_not_allowed");
      return true;
    },
  );
});
