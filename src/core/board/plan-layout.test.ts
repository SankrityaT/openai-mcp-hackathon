import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type PlanInput,
  type PlanNodeInput,
  ROOT_ID,
  layoutMissionPlan,
} from "./plan-layout";

function node(clientId: string, dependsOn: string[] = []): PlanNodeInput {
  return {
    clientId,
    codename: `Codename ${clientId}`,
    roleLabel: `Role ${clientId}`,
    objective: `Objective ${clientId}`,
    capabilityNames: [],
    dependsOn,
  };
}

function plan(nodes: PlanNodeInput[]): PlanInput {
  return { title: "Mission", summary: "Summary", nodes, approvalBoundaries: [] };
}

test("independent branches share a column and depend on the mission root", () => {
  const layout = layoutMissionPlan(plan([node("a"), node("b"), node("c")]));

  assert.deepEqual(new Set(layout.nodes.map((n) => n.depth)), new Set([0]));
  assert.equal(new Set(layout.nodes.map((n) => n.x)).size, 1, "same depth must share a column");
  assert.equal(new Set(layout.nodes.map((n) => n.y)).size, 3, "siblings must not overlap");
  assert.deepEqual(
    layout.edges.map((e) => e.from),
    [ROOT_ID, ROOT_ID, ROOT_ID],
  );
});

test("depth is the longest path, not the shortest", () => {
  // d depends on both a (depth 0) and c (depth 2), so it must sit at depth 3.
  const layout = layoutMissionPlan(
    plan([node("a"), node("b", ["a"]), node("c", ["b"]), node("d", ["a", "c"])]),
  );
  const depth = Object.fromEntries(layout.nodes.map((n) => [n.id, n.depth]));
  assert.deepEqual(depth, { a: 0, b: 1, c: 2, d: 3 });
});

test("a dependency cycle is broken at the back edge, not inflated", () => {
  const layout = layoutMissionPlan(plan([node("a", ["b"]), node("b", ["a"])]));

  assert.equal(layout.nodes.length, 2);
  for (const n of layout.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
    // One node absorbs the ordering, the other is treated as the cycle entry.
    assert.ok(n.depth === 0 || n.depth === 1, `unexpected depth ${n.depth}`);
  }
  assert.deepEqual(layout.nodes.map((n) => n.depth).sort(), [0, 1]);
});

test("a long dependency chain does not overflow the stack", () => {
  const chain = Array.from({ length: 4_000 }, (_, i) =>
    node(`n${i}`, i === 0 ? [] : [`n${i - 1}`]),
  );
  const layout = layoutMissionPlan(plan(chain));
  assert.equal(layout.nodes.length, 4_000);
  assert.equal(layout.nodes.at(-1)!.depth, 3_999);
});

test("self-references and unknown dependencies are ignored, not dropped", () => {
  const layout = layoutMissionPlan(plan([node("a", ["a"]), node("b", ["ghost"])]));

  assert.equal(layout.nodes.length, 2, "no node may disappear");
  assert.equal(layout.nodes.every((n) => n.depth === 0), true);
  // Both lost every real dependency, so both hang off the root.
  assert.deepEqual(layout.edges, [
    { from: ROOT_ID, to: "a" },
    { from: ROOT_ID, to: "b" },
  ]);
});

test("duplicate client ids collapse so branches never stack invisibly", () => {
  const layout = layoutMissionPlan(plan([node("a"), node("a"), node("b")]));
  assert.deepEqual(layout.nodes.map((n) => n.id), ["a", "b"]);
});

test("bounds enclose the root and every node", () => {
  const layout = layoutMissionPlan(plan([node("a"), node("b", ["a"]), node("c", ["b"])]));
  const boxes = [layout.root, ...layout.nodes];

  for (const box of boxes) {
    assert.ok(box.x >= layout.bounds.x, `${box.x} outside left bound`);
    assert.ok(box.y >= layout.bounds.y, `${box.y} outside top bound`);
    assert.ok(box.x + box.width <= layout.bounds.x + layout.bounds.width);
    assert.ok(box.y + box.height <= layout.bounds.y + layout.bounds.height);
  }
  assert.ok(layout.bounds.width >= NODE_WIDTH);
  assert.ok(layout.bounds.height >= NODE_HEIGHT);
});

test("the root anchor sits left of the first column", () => {
  const layout = layoutMissionPlan(plan([node("a")]));
  assert.ok(layout.root.x + layout.root.width < layout.nodes[0].x);
});
