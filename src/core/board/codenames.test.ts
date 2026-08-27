import assert from "node:assert/strict";
import { test } from "node:test";
import { CODENAME_POOL, assignCodenames } from "./codenames";

const nodes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ codename: `Model Invented ${i}`, id: `n${i}` }));

test("model-produced codenames are replaced from the curated pool", () => {
  const named = assignCodenames(nodes(4), "mission-a");
  for (const node of named) {
    assert.ok(CODENAME_POOL.includes(node.codename), `${node.codename} not in pool`);
  }
});

test("assignment is deterministic per seed and distinct across nodes", () => {
  const a1 = assignCodenames(nodes(6), "mission-a").map((n) => n.codename);
  const a2 = assignCodenames(nodes(6), "mission-a").map((n) => n.codename);
  const b = assignCodenames(nodes(6), "mission-b").map((n) => n.codename);
  assert.deepEqual(a1, a2, "same seed must name identically");
  assert.equal(new Set(a1).size, 6, "codenames must not repeat within a plan");
  assert.notDeepEqual(a1, b, "different seeds should rotate the pool");
});

test("pool exhaustion wraps with a numeral instead of colliding", () => {
  const many = assignCodenames(nodes(CODENAME_POOL.length + 2), "seed");
  const names = many.map((n) => n.codename);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.some((n) => / 2$/.test(n)));
});
