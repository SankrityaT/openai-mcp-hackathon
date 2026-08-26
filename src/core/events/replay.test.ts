import assert from "node:assert/strict";
import test from "node:test";
import type {
  JsonValue,
  Mission,
  MissionApproval,
  MissionEvent,
  MissionNode,
} from "../contracts/types";
import { buildIdempotencyKey, fingerprintRequest } from "../idempotency";
import { reduceMissionEvent, replayMissionEvents } from "./replay";

const tenantId = "00000000-0000-4000-8000-000000000001";
const missionId = "00000000-0000-4000-8000-000000000002";
const nodeId = "00000000-0000-4000-8000-000000000003";
const approvalId = "00000000-0000-4000-8000-000000000004";

const mission: Mission = {
  id: missionId,
  tenantId,
  title: "Generic mission",
  status: "draft",
  mandateVersion: 1,
  rootNodeId: null,
  lastEventSequence: 0,
  stateVersion: 0,
  budgetLimits: {},
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

function event(
  sequence: number,
  type: MissionEvent["type"],
  payload: JsonValue,
  extra: Partial<MissionEvent> = {},
): MissionEvent {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    tenantId,
    missionId,
    sequence,
    type,
    actor: { kind: "system", id: "test" },
    correlationId: "00000000-0000-4000-8000-000000000099",
    payload,
    trust: "derived",
    createdAt: `2026-08-26T00:00:0${sequence}.000Z`,
    ...extra,
  };
}

test("replay builds current mission and node state in strict sequence", () => {
  const node: MissionNode = {
    id: nodeId,
    tenantId,
    missionId,
    parentId: null,
    codename: "Atlas",
    roleLabel: "Research",
    objective: "Collect bounded evidence",
    status: "planned",
    requiredCapabilities: [],
    inputRefs: [],
    outputRefs: [],
    budgetLimits: {},
    version: 1,
  };
  const state = replayMissionEvents([
    event(1, "mission.created", { mission: mission as unknown as JsonValue }),
    event(2, "node.planned", { node: node as unknown as JsonValue }, { nodeId }),
    event(3, "node.started", {}, { nodeId }),
    event(4, "node.completed", {}, { nodeId }),
    event(5, "mission.completed", {}),
  ]);
  assert.equal(state.mission.status, "completed");
  assert.equal(state.mission.lastEventSequence, 5);
  assert.equal(state.nodes[nodeId].status, "completed");
  assert.equal(state.nodes[nodeId].version, 3);
});

test("replay rejects gaps and cross-mission events", () => {
  assert.throws(
    () => replayMissionEvents([
      event(1, "mission.created", { mission: mission as unknown as JsonValue }),
      event(3, "mission.completed", {}),
    ]),
    /Expected sequence 2/,
  );
  assert.throws(
    () => replayMissionEvents([
      event(1, "mission.created", { mission: mission as unknown as JsonValue }),
      event(2, "mission.completed", {}, { missionId: "00000000-0000-4000-8000-000000000777" }),
    ]),
    /crosses a mission or tenant boundary/,
  );
});

test("approval materialization cannot settle twice", () => {
  const approval: MissionApproval = {
    id: approvalId,
    tenantId,
    missionId,
    nodeId: null,
    status: "pending",
    category: "external_write",
    actionFingerprint: "approval0000000000000000000000000000",
    recommendation: "Approve the exact action",
    alternatives: [],
    evidence: [],
    consequence: "An external record changes",
    mandateVersion: 1,
    expiresAt: null,
    resolvedAt: null,
    resolution: null,
  };
  let state = reduceMissionEvent(
    null,
    event(1, "mission.created", { mission: mission as unknown as JsonValue }),
  );
  state = reduceMissionEvent(
    state,
    event(2, "approval.requested", { approval: approval as unknown as JsonValue }),
  );
  state = reduceMissionEvent(
    state,
    event(3, "approval.resolved", {
      approvalId,
      status: "resolved",
      resolution: { decision: "accepted" },
    }),
  );
  assert.equal(state.approvals[approvalId].status, "resolved");
  assert.throws(
    () => reduceMissionEvent(
      state,
      event(4, "approval.resolved", {
        approvalId,
        status: "resolved",
        resolution: { decision: "accepted" },
      }),
    ),
    /already settled/,
  );
});

test("idempotency keys are stable across object key order and scoped inputs", () => {
  const left = { alpha: 1, nested: { beta: true, gamma: [1, 2] } } as JsonValue;
  const right = { nested: { gamma: [1, 2], beta: true }, alpha: 1 } as JsonValue;
  assert.equal(fingerprintRequest(left), fingerprintRequest(right));
  const base = {
    missionId,
    nodeId,
    capabilityId: "capability-1",
    action: "records.update",
    mandateVersion: 1,
    request: left,
  };
  assert.equal(buildIdempotencyKey(base), buildIdempotencyKey({ ...base, request: right }));
  assert.notEqual(buildIdempotencyKey(base), buildIdempotencyKey({ ...base, mandateVersion: 2 }));
});

test("revert restores a checkpoint snapshot without deleting event history", () => {
  const created = event(1, "mission.created", { mission: mission as unknown as JsonValue });
  const initial = replayMissionEvents([created]);
  const failed = replayMissionEvents([created, event(2, "mission.failed", {})]);
  const restored = reduceMissionEvent(
    failed,
    event(3, "mission.reverted", {
      checkpointId: "00000000-0000-4000-8000-000000000005",
      snapshot: initial as unknown as JsonValue,
    }),
  );
  assert.equal(restored.mission.status, "draft");
  assert.equal(failed.mission.status, "failed");
});
