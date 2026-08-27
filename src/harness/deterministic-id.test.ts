import assert from "node:assert/strict";
import test from "node:test";
import { deterministicUuid } from "./deterministic-id";

test("durable ids are stable, distinct, and UUID-shaped", () => {
  const first = deterministicUuid("node", "mission-1", "client-1");
  assert.equal(first, deterministicUuid("node", "mission-1", "client-1"));
  assert.notEqual(first, deterministicUuid("node", "mission-1", "client-2"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

