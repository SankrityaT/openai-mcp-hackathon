import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_LOG_LIMIT,
  applyMissionEvent,
  createEmptyRealtimeState,
} from "./apply-mission-event";
import type {
  Mandate,
  Mission,
  MissionApproval,
  MissionEdge,
  MissionEvent,
  MissionNode,
  MissionSnapshot,
} from "@/core/contracts/types";

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    tenantId: "tenant-1",
    title: "Test mission",
    status: "running",
    mandateVersion: 1,
    rootNodeId: null,
    lastEventSequence: 1,
    stateVersion: 1,
    budgetLimits: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    missionId: "mission-1",
    version: 1,
    goal: "Do the thing",
    constraints: [],
    authority: {
      freePassage: false,
      allowedCapabilityIds: [],
      allowedOrigins: [],
      allowedTargets: [],
      allowedRiskLevels: ["low"],
      maxAutonomousCostMicrounits: 0,
      allowExternalSideEffects: false,
      requireApprovalCategories: [],
    },
    selectedContextCardIds: [],
    createdBy: { kind: "user", id: "user-1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function node(overrides: Partial<MissionNode> = {}): MissionNode {
  return {
    id: "node-1",
    tenantId: "tenant-1",
    missionId: "mission-1",
    parentId: null,
    codename: "alpha",
    roleLabel: "Scout",
    objective: "Look around",
    status: "planned",
    requiredCapabilities: [],
    inputRefs: [],
    outputRefs: [],
    budgetLimits: {},
    version: 1,
    ...overrides,
  };
}

function approval(overrides: Partial<MissionApproval> = {}): MissionApproval {
  return {
    id: "approval-1",
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    status: "pending",
    category: "external_write",
    actionFingerprint: "fp-1",
    recommendation: "do it",
    alternatives: [],
    evidence: [],
    consequence: "sends an email",
    mandateVersion: 1,
    expiresAt: null,
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    mission: mission(),
    mandate: mandate(),
    nodes: [node()],
    edges: [],
    pendingApprovals: [],
    latestSequence: 1,
    ...overrides,
  };
}

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

test("node.started transitions node status and bumps mission sequence bookkeeping", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({ type: "node.started", sequence: 2, nodeId: "node-1" }),
  );
  assert.equal(next.needsResync, false);
  assert.equal(next.snapshot?.nodes[0].status, "running");
  assert.equal(next.snapshot?.nodes[0].version, 2);
  assert.equal(next.snapshot?.mission.lastEventSequence, 2);
  assert.equal(next.snapshot?.mission.stateVersion, 2);
  assert.equal(next.snapshot?.latestSequence, 2);
  assert.equal(next.activity.length, 1);
  assert.equal(next.activity[0].id, "event-2");
});

test("node.planned appends a new node", () => {
  const state = createEmptyRealtimeState(snapshot({ nodes: [] }));
  const planned = node({ id: "node-2" });
  const next = applyMissionEvent(
    state,
    event({ type: "node.planned", sequence: 2, payload: { node: planned } }),
  );
  assert.equal(next.needsResync, false);
  assert.equal(next.snapshot?.nodes.length, 1);
  assert.equal(next.snapshot?.nodes[0].id, "node-2");
});

test("node.redirected materializes the producer's instruction as the objective", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({
      type: "node.redirected",
      sequence: 2,
      nodeId: "node-1",
      // What LiveMissionDataSource.redirectNode durably persists.
      payload: { instruction: "New instruction" },
    }),
  );
  assert.equal(next.snapshot?.nodes[0].objective, "New instruction");
  assert.equal(next.snapshot?.nodes[0].version, 2);
  assert.equal(next.needsResync, false);
});

test("node.redirected still accepts a legacy objective payload", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({
      type: "node.redirected",
      sequence: 2,
      nodeId: "node-1",
      payload: { objective: "New objective" },
    }),
  );
  assert.equal(next.snapshot?.nodes[0].objective, "New objective");
  assert.equal(next.snapshot?.nodes[0].version, 2);
  assert.equal(next.needsResync, false);
});

test("node.redirected without a directive asks for a resync", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({ type: "node.redirected", sequence: 2, nodeId: "node-1", payload: {} }),
  );
  assert.equal(next.needsResync, true);
  assert.equal(next.snapshot?.nodes[0].objective, snapshot().nodes[0].objective);
});

test("mission.completed/failed/cancelled update mission status", () => {
  for (const [type, status] of [
    ["mission.completed", "completed"],
    ["mission.failed", "failed"],
    ["mission.cancelled", "cancelled"],
  ] as const) {
    const state = createEmptyRealtimeState(snapshot());
    const next = applyMissionEvent(state, event({ type, sequence: 2 }));
    assert.equal(next.snapshot?.mission.status, status, type);
  }
});

test("mandate.revised and mandate.approved update mandateVersion from payload", () => {
  for (const type of ["mandate.revised", "mandate.approved"] as const) {
    const state = createEmptyRealtimeState(snapshot());
    const next = applyMissionEvent(state, event({ type, sequence: 2, payload: { version: 4 } }));
    assert.equal(next.needsResync, false, type);
    assert.equal(next.snapshot?.mission.mandateVersion, 4, type);
  }
});

test("dependency.added appends an edge and is idempotent on a duplicate id", () => {
  const edge: MissionEdge = {
    id: "edge-1",
    tenantId: "tenant-1",
    missionId: "mission-1",
    fromNodeId: "node-1",
    toNodeId: "node-1",
    kind: "informs",
  };
  const state = createEmptyRealtimeState(snapshot());
  const first = applyMissionEvent(
    state,
    event({ type: "dependency.added", sequence: 2, payload: { edge } }),
  );
  assert.equal(first.snapshot?.edges.length, 1);

  const second = applyMissionEvent(
    first,
    event({ type: "dependency.added", sequence: 3, payload: { edge } }),
  );
  assert.equal(second.needsResync, false);
  assert.equal(second.snapshot?.edges.length, 1);
});

test("dependency.removed and dependency.rerouted mutate the edge list", () => {
  const edgeA: MissionEdge = {
    id: "edge-a",
    tenantId: "tenant-1",
    missionId: "mission-1",
    fromNodeId: "node-1",
    toNodeId: "node-1",
    kind: "informs",
  };
  const withEdge = snapshot({ edges: [edgeA] });

  const removed = applyMissionEvent(
    createEmptyRealtimeState(withEdge),
    event({ type: "dependency.removed", sequence: 2, payload: { edgeId: "edge-a" } }),
  );
  assert.equal(removed.snapshot?.edges.length, 0);

  const edgeB: MissionEdge = { ...edgeA, id: "edge-b", kind: "blocks" };
  const rerouted = applyMissionEvent(
    createEmptyRealtimeState(withEdge),
    event({
      type: "dependency.rerouted",
      sequence: 2,
      payload: { removedEdgeId: "edge-a", edge: edgeB },
    }),
  );
  assert.equal(rerouted.snapshot?.edges.length, 1);
  assert.equal(rerouted.snapshot?.edges[0].id, "edge-b");
});

test("approval.requested adds a pending approval, resolved/expired remove it", () => {
  const requested = applyMissionEvent(
    createEmptyRealtimeState(snapshot()),
    event({ type: "approval.requested", sequence: 2, payload: { approval: approval() } }),
  );
  assert.equal(requested.snapshot?.pendingApprovals.length, 1);

  const resolved = applyMissionEvent(
    requested,
    event({
      type: "approval.resolved",
      sequence: 3,
      payload: { approvalId: "approval-1", status: "resolved" },
    }),
  );
  assert.equal(resolved.snapshot?.pendingApprovals.length, 0);

  const requestedAgain = applyMissionEvent(
    requested,
    event({ type: "approval.requested", sequence: 3, payload: { approval: approval({ id: "approval-2" }) } }),
  );
  const expired = applyMissionEvent(
    requestedAgain,
    event({ type: "approval.expired", sequence: 4, payload: { approvalId: "approval-2" } }),
  );
  assert.equal(expired.snapshot?.pendingApprovals.some((a) => a.id === "approval-2"), false);
});

test("checkpoint.created has no client-visible field effect but advances bookkeeping", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({ type: "checkpoint.created", sequence: 2, payload: { checkpointId: "cp-1" } }),
  );
  assert.equal(next.needsResync, false);
  assert.deepEqual(next.snapshot?.nodes, state.snapshot?.nodes);
  assert.equal(next.snapshot?.latestSequence, 2);
});

test("non-materializing families (tool/evidence/memory/capability/quota/policy/security) only touch activity", () => {
  const nonMaterializing = [
    "capability.discovered",
    "tool.requested",
    "tool.completed",
    "evidence.recorded",
    "memory.proposed",
    "quota.consumed",
    "policy.denied",
    "security.recorded",
  ] as const;

  let state = createEmptyRealtimeState(snapshot());
  let seq = 1;
  for (const type of nonMaterializing) {
    seq += 1;
    state = applyMissionEvent(state, event({ type, sequence: seq }));
    assert.equal(state.needsResync, false, type);
    assert.deepEqual(state.snapshot?.nodes, [node()], type);
  }
  assert.equal(state.activity.length, nonMaterializing.length);
  assert.equal(state.snapshot?.latestSequence, seq);
});

test("mission.created, mission.reverted, and node.reverted request a resync instead of guessing", () => {
  for (const type of ["mission.created", "mission.reverted", "node.reverted"] as const) {
    const state = createEmptyRealtimeState(snapshot());
    const next = applyMissionEvent(state, event({ type, sequence: 2 }));
    assert.equal(next.needsResync, true, type);
    // The last good snapshot is preserved, not corrupted, while a refetch is pending.
    assert.deepEqual(next.snapshot, state.snapshot, type);
  }
});

test("an unknown node reference requests a resync rather than throwing", () => {
  const state = createEmptyRealtimeState(snapshot());
  const next = applyMissionEvent(
    state,
    event({ type: "node.started", sequence: 2, nodeId: "does-not-exist" }),
  );
  assert.equal(next.needsResync, true);
  assert.equal(next.snapshot?.nodes[0].status, "planned");
});

test("an event with no baseline snapshot requests a resync", () => {
  const next = applyMissionEvent(
    createEmptyRealtimeState(null),
    event({ type: "node.started", sequence: 1, nodeId: "node-1" }),
  );
  assert.equal(next.needsResync, true);
  assert.equal(next.snapshot, null);
});

test("applying the same event id twice is a no-op the second time", () => {
  const state = createEmptyRealtimeState(snapshot());
  const e = event({ type: "node.started", sequence: 2, nodeId: "node-1" });
  const once = applyMissionEvent(state, e);
  const twice = applyMissionEvent(once, e);
  assert.deepEqual(twice, once);
});

test("an event at or before the current latestSequence is ignored for materialization", () => {
  const state = createEmptyRealtimeState(snapshot({ latestSequence: 5 }));
  const stale = event({ type: "node.completed", sequence: 3, nodeId: "node-1", id: "stale-event" });
  const next = applyMissionEvent(state, stale);
  assert.equal(next.snapshot?.nodes[0].status, "planned");
  assert.equal(next.needsResync, false);
  assert.equal(next.activity.length, 1);
});

test("activity log is bounded and drops the oldest entries first", () => {
  let state = createEmptyRealtimeState(snapshot());
  const total = ACTIVITY_LOG_LIMIT + 25;
  for (let i = 2; i <= total + 1; i += 1) {
    state = applyMissionEvent(state, event({ type: "evidence.recorded", sequence: i }));
  }
  assert.equal(state.activity.length, ACTIVITY_LOG_LIMIT);
  assert.equal(state.activity[0].sequence, total + 1 - ACTIVITY_LOG_LIMIT + 1);
  assert.equal(state.activity[state.activity.length - 1].sequence, total + 1);
});
