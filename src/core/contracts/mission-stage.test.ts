import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMissionStage,
  isTerminalMissionStage,
  type MissionStageInput,
} from "./mission-stage";
import type { NodeStatus } from "./types";

function approved(...statuses: NodeStatus[]): MissionStageInput {
  return {
    mandate: { approvedAt: "2026-01-01T00:00:00.000Z" },
    nodes: statuses.map((status) => ({ status })),
  };
}

test("no mission at all is a draft", () => {
  assert.equal(deriveMissionStage(null), "draft");
  assert.equal(deriveMissionStage(undefined), "draft");
  assert.equal(deriveMissionStage(), "draft");
});

test("a mission whose mandate is not approved is awaiting the mandate", () => {
  assert.equal(deriveMissionStage({ mandate: {}, nodes: [] }), "awaiting_mandate");
  assert.equal(
    deriveMissionStage({ mandate: { approvedAt: null }, nodes: [] }),
    "awaiting_mandate",
  );
  assert.equal(
    deriveMissionStage({ mandate: { approvedAt: "" }, nodes: [] }),
    "awaiting_mandate",
  );
  // Nodes that somehow exist ahead of approval do not change the answer.
  assert.equal(
    deriveMissionStage({ mandate: { approvedAt: null }, nodes: [{ status: "running" }] }),
    "awaiting_mandate",
  );
});

test("an approved mandate with no nodes yet is planning", () => {
  assert.equal(deriveMissionStage(approved()), "planning");
  assert.equal(
    deriveMissionStage({ mandate: { approvedAt: "2026-01-01T00:00:00.000Z" }, nodes: null }),
    "planning",
  );
});

test("a node awaiting a person or a failed node needs attention", () => {
  assert.equal(deriveMissionStage(approved("needs_approval")), "needs_attention");
  assert.equal(deriveMissionStage(approved("failed")), "needs_attention");
  assert.equal(deriveMissionStage(approved("running", "needs_approval")), "needs_attention");
  assert.equal(deriveMissionStage(approved("completed", "failed")), "needs_attention");
  // Attention wins over completion.
  assert.equal(deriveMissionStage(approved("completed", "needs_approval")), "needs_attention");
});

test("every node completed is complete", () => {
  assert.equal(deriveMissionStage(approved("completed")), "complete");
  assert.equal(deriveMissionStage(approved("completed", "completed")), "complete");
});

test("anything else in flight is executing", () => {
  for (const status of ["planned", "running", "paused", "waiting", "cancelled"] as const) {
    assert.equal(deriveMissionStage(approved(status)), "executing", status);
  }
  assert.equal(deriveMissionStage(approved("completed", "running")), "executing");
  assert.equal(deriveMissionStage(approved("completed", "cancelled")), "executing");
});

test("mission.status is never read", () => {
  // The backend leaves this at "draft" forever; the stage must not follow it.
  const stuck = {
    mission: { status: "draft" },
    mandate: { approvedAt: "2026-01-01T00:00:00.000Z" },
    nodes: [{ status: "running" as NodeStatus }],
  };
  assert.equal(deriveMissionStage(stuck), "executing");
});

test("only completion is terminal", () => {
  assert.equal(isTerminalMissionStage("complete"), true);
  for (const stage of [
    "draft",
    "awaiting_mandate",
    "planning",
    "executing",
    "needs_attention",
  ] as const) {
    assert.equal(isTerminalMissionStage(stage), false, stage);
  }
});
