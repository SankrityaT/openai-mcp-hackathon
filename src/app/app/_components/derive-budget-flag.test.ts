import assert from "node:assert/strict";
import test from "node:test";
import { deriveBudgetFlag, type BudgetFlagNode } from "./derive-budget-flag";
import type { MissionEvent } from "@/core/contracts/types";

function event(overrides: Partial<MissionEvent> & Pick<MissionEvent, "type" | "sequence">): MissionEvent {
  return {
    id: `event-${overrides.sequence}`,
    tenantId: "tenant-1",
    missionId: "mission-1",
    actor: { kind: "system", id: "system" },
    correlationId: "corr-1",
    payload: {},
    trust: "trusted",
    createdAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

const NODES: BudgetFlagNode[] = [{ id: "node-1", codename: "Lyra" }];

test("returns null when no budget stop has happened", () => {
  const events: MissionEvent[] = [
    event({ type: "node.started", sequence: 1, nodeId: "node-1" }),
    event({ type: "node.completed", sequence: 2, nodeId: "node-1" }),
  ];
  assert.equal(deriveBudgetFlag(events, NODES), null);
});

test("resolves the quota.consumed amounts and codename for the most recent cost stop", () => {
  const events: MissionEvent[] = [
    event({ type: "node.started", sequence: 1, nodeId: "node-1" }),
    event({
      type: "quota.consumed",
      sequence: 2,
      nodeId: "node-1",
      payload: { kind: "cost", used: 9_000_000, limit: 8_000_000, exhausted: true },
    }),
    event({
      type: "node.failed",
      sequence: 3,
      nodeId: "node-1",
      payload: { nodeId: "node-1", reason: "budget_exhausted", kind: "cost" },
    }),
  ];
  assert.deepEqual(deriveBudgetFlag(events, NODES), {
    nodeId: "node-1",
    nodeCodename: "Lyra",
    usedMicrounits: 9_000_000,
    limitMicrounits: 8_000_000,
  });
});

test("falls back to the node id when the node is missing from the nodes list", () => {
  const events: MissionEvent[] = [
    event({
      type: "quota.consumed",
      sequence: 1,
      nodeId: "node-9",
      payload: { kind: "cost", used: 1, limit: 2, exhausted: true },
    }),
    event({
      type: "node.failed",
      sequence: 2,
      nodeId: "node-9",
      payload: { nodeId: "node-9", reason: "budget_exhausted", kind: "cost" },
    }),
  ];
  const result = deriveBudgetFlag(events, []);
  assert.equal(result?.nodeCodename, "node-9");
});

test("ignores a node.failed that is not a cost budget stop", () => {
  const events: MissionEvent[] = [
    event({
      type: "node.failed",
      sequence: 1,
      nodeId: "node-1",
      payload: { nodeId: "node-1", reason: "tool_error" },
    }),
    event({
      type: "node.failed",
      sequence: 2,
      nodeId: "node-1",
      payload: { nodeId: "node-1", reason: "budget_exhausted", kind: "max_tool_calls" },
    }),
  ];
  assert.equal(deriveBudgetFlag(events, NODES), null);
});

test("returns null when the failure has no matching quota.consumed amounts", () => {
  const events: MissionEvent[] = [
    event({
      type: "node.failed",
      sequence: 1,
      nodeId: "node-1",
      payload: { nodeId: "node-1", reason: "budget_exhausted", kind: "cost" },
    }),
  ];
  assert.equal(deriveBudgetFlag(events, NODES), null);
});

test("picks the most recent of multiple cost stops, and the quota.consumed for that node", () => {
  const events: MissionEvent[] = [
    event({
      type: "quota.consumed",
      sequence: 1,
      nodeId: "node-1",
      payload: { kind: "cost", used: 1_000_000, limit: 500_000, exhausted: true },
    }),
    event({
      type: "node.failed",
      sequence: 2,
      nodeId: "node-1",
      payload: { nodeId: "node-1", reason: "budget_exhausted", kind: "cost" },
    }),
    event({
      type: "quota.consumed",
      sequence: 3,
      nodeId: "node-2",
      payload: { kind: "cost", used: 12_000_000, limit: 8_000_000, exhausted: true },
    }),
    event({
      type: "node.failed",
      sequence: 4,
      nodeId: "node-2",
      payload: { nodeId: "node-2", reason: "budget_exhausted", kind: "cost" },
    }),
  ];
  const result = deriveBudgetFlag(events, [
    { id: "node-1", codename: "Lyra" },
    { id: "node-2", codename: "Orion" },
  ]);
  assert.deepEqual(result, {
    nodeId: "node-2",
    nodeCodename: "Orion",
    usedMicrounits: 12_000_000,
    limitMicrounits: 8_000_000,
  });
});
