import assert from "node:assert/strict";
import test from "node:test";
import {
  type BoardSpineNode,
  codenameForNode,
  toCardeaDataMode,
  toNodeSummaries,
} from "./board-mission-actions";

const NODES: BoardSpineNode[] = [
  { id: "node-1", codename: "SCOUT", roleLabel: "Research", status: "running" },
  { id: "node-2", codename: "LEDGER", roleLabel: "Reconciliation", status: "paused" },
];

test("toCardeaDataMode reports live only when persistence is available", () => {
  assert.equal(toCardeaDataMode({ persistenceAvailable: true }), "live");
});

test("toCardeaDataMode reports fixture for a board that cannot persist", () => {
  assert.equal(toCardeaDataMode({ persistenceAvailable: false }), "fixture");
});

test("toNodeSummaries renames roleLabel to role and preserves order", () => {
  assert.deepEqual(toNodeSummaries(NODES), [
    { id: "node-1", codename: "SCOUT", role: "Research", status: "running" },
    { id: "node-2", codename: "LEDGER", role: "Reconciliation", status: "paused" },
  ]);
});

test("toNodeSummaries maps an empty spine to an empty list", () => {
  assert.deepEqual(toNodeSummaries([]), []);
});

test("toNodeSummaries invents no fields beyond the tool summary shape", () => {
  const [summary] = toNodeSummaries(NODES);
  assert.deepEqual(Object.keys(summary).sort(), ["codename", "id", "role", "status"]);
});

test("codenameForNode returns the codename of a known node", () => {
  assert.equal(codenameForNode(NODES, "node-2"), "LEDGER");
});

test("codenameForNode returns null for an unknown node", () => {
  assert.equal(codenameForNode(NODES, "node-404"), null);
});

test("codenameForNode returns null against an empty spine", () => {
  assert.equal(codenameForNode([], "node-1"), null);
});
