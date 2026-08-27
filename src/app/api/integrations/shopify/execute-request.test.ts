import assert from "node:assert/strict";
import test from "node:test";
import { parseShopifyExecuteBody, SHOPIFY_REQUEST_LIMITS } from "./execute-request";

test("accepts a well-formed execute command", () => {
  const parsed = parseShopifyExecuteBody({
    capabilityId: "shopify.catalog_search",
    input: { query: "wool runner" },
    missionId: "mission-1",
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.command.capabilityId, "shopify.catalog_search");
  assert.deepEqual(parsed.command.input, { query: "wool runner" });
  assert.equal(parsed.command.missionId, "mission-1");
});

test("defaults a missing input to an empty object rather than rejecting", () => {
  const parsed = parseShopifyExecuteBody({ capabilityId: "shopify.catalog_search" });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.command.input, {});
});

test("refuses a body that is not an object", () => {
  for (const body of [null, undefined, "capabilityId", 42, ["shopify.catalog_search"]]) {
    const parsed = parseShopifyExecuteBody(body);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok ? "" : parsed.reason, "body_must_be_object");
  }
});

test("refuses every Shopify checkout, payment, and order tool name", () => {
  // These are real tool names on Shopify's live UCP endpoint. None of them is a
  // Cardea capability id, so the route rejects them before anything else runs.
  for (const name of [
    "complete_checkout",
    "create_checkout",
    "update_checkout",
    "cancel_checkout",
    "get_checkout",
    "get_order",
    "shopify.complete_checkout",
    "shopify.checkout",
  ]) {
    const parsed = parseShopifyExecuteBody({ capabilityId: name, input: {} });
    assert.equal(parsed.ok, false, `${name} must be refused`);
    assert.equal(parsed.ok ? "" : parsed.reason, "unknown_capability");
  }
});

test("refuses an unknown or non-string capability id", () => {
  for (const capabilityId of [undefined, null, 7, {}, "", "composio.gmail_fetch_emails", "shopify."]) {
    const parsed = parseShopifyExecuteBody({ capabilityId, input: {} });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok ? "" : parsed.reason, "unknown_capability");
  }
});

test("accepts each of the five discovered capability ids", () => {
  for (const capabilityId of [
    "shopify.catalog_search",
    "shopify.product_details",
    "shopify.cart_prepare",
    "shopify.cart_update",
    "shopify.cart_read",
  ]) {
    assert.ok(parseShopifyExecuteBody({ capabilityId, input: {} }).ok, capabilityId);
  }
});

test("refuses an input that is not an object", () => {
  for (const input of ["query=shoes", 5, ["shoes"], true]) {
    const parsed = parseShopifyExecuteBody({ capabilityId: "shopify.catalog_search", input });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok ? "" : parsed.reason, "input_must_be_object");
  }
});

test("truncates client-supplied identifiers to their bounds", () => {
  const parsed = parseShopifyExecuteBody({
    capabilityId: "shopify.cart_read",
    input: { cartId: "c1" },
    missionId: "m".repeat(500),
    correlationId: "c".repeat(500),
    idempotencyKey: "k".repeat(500),
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.command.missionId?.length, SHOPIFY_REQUEST_LIMITS.maxMissionIdChars);
  assert.equal(parsed.command.correlationId?.length, SHOPIFY_REQUEST_LIMITS.maxCorrelationIdChars);
  assert.equal(parsed.command.idempotencyKey?.length, SHOPIFY_REQUEST_LIMITS.maxIdempotencyKeyChars);
});

test("treats empty or non-string identifiers as absent so the route generates its own", () => {
  const parsed = parseShopifyExecuteBody({
    capabilityId: "shopify.cart_read",
    input: { cartId: "c1" },
    missionId: "",
    correlationId: 12345,
    idempotencyKey: null,
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.command.missionId, undefined);
  assert.equal(parsed.command.correlationId, undefined);
  assert.equal(parsed.command.idempotencyKey, undefined);
});

test("ignores unexpected top-level keys rather than forwarding them", () => {
  const parsed = parseShopifyExecuteBody({
    capabilityId: "shopify.catalog_search",
    input: { query: "shoes" },
    // A caller cannot smuggle a different store or endpoint through the route.
    storeDomain: "attacker.example",
    endpoint: "https://attacker.example/api/mcp",
  });
  assert.ok(parsed.ok);
  assert.deepEqual(Object.keys(parsed.command).sort(), [
    "capabilityId",
    "correlationId",
    "idempotencyKey",
    "input",
    "missionId",
  ]);
  assert.equal(JSON.stringify(parsed.command).includes("attacker.example"), false);
});
