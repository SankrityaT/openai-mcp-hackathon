import assert from "node:assert/strict";
import test from "node:test";
import {
  assertUserAppendableEvent,
  parseAppendEventBody,
  parseCreateMissionBody,
  parseResolveApprovalBody,
  readBoundedJsonBody,
} from "./commands";

const authority = {
  freePassage: false,
  allowedCapabilityIds: ["capability-1"],
  allowedOrigins: ["https://allowed.example"],
  allowedTargets: ["target-1"],
  allowedRiskLevels: ["low"],
  maxAutonomousCostMicrounits: 0,
  allowExternalSideEffects: false,
  requireApprovalCategories: [],
};

test("mission command parsing bounds and normalizes input", () => {
  const parsed = parseCreateMissionBody({
    title: "Research mission",
    goal: "Collect bounded evidence",
    constraints: [{ maximum: 3 }],
    authority,
    selectedContextCardIds: [],
    budgetLimits: { maxToolCalls: 3 },
  });
  assert.equal(parsed.title, "Research mission");
  assert.deepEqual(parsed.budgetLimits, { maxToolCalls: 3 });
  assert.throws(
    () => parseCreateMissionBody({ title: "", goal: "Goal", authority }),
    /body.title/,
  );
});

test("event command accepts only catalogued event types", () => {
  const base = {
    expectedSequence: 1,
    correlationId: "00000000-0000-4000-8000-000000000001",
    payload: {},
    trust: "trusted",
  };
  assert.equal(parseAppendEventBody({ ...base, type: "evidence.recorded" }).type, "evidence.recorded");
  assert.throws(
    () => parseAppendEventBody({ ...base, type: "relocation.house_selected" }),
    /known mission event/,
  );
});

test("user event boundary rejects internal events and mismatched state", () => {
  const base = {
    expectedSequence: 1,
    correlationId: "00000000-0000-4000-8000-000000000001",
    payload: {},
    trust: "trusted",
  };
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({ ...base, type: "policy.denied" })),
    /cannot be appended by a user session/,
  );
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "mission.cancelled",
      missionStatus: "running",
    })),
    /materialization does not match/,
  );
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "mandate.approved",
      missionStatus: "running",
    })),
    /Mandate events cannot carry/,
  );
  assert.equal(
    assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "mission.cancelled",
      missionStatus: "cancelled",
    })).type,
    "mission.cancelled",
  );
});

test("captured companion evidence is appendable only as untrusted, non-materializing", () => {
  const base = {
    expectedSequence: 4,
    correlationId: "00000000-0000-4000-8000-000000000001",
    type: "evidence.recorded",
    payload: { source: "webmcp.companion", origin: "https://companion.example" },
  };
  const accepted = assertUserAppendableEvent(
    parseAppendEventBody({ ...base, trust: "untrusted" }),
  );
  assert.equal(accepted.type, "evidence.recorded");
  assert.equal(accepted.trust, "untrusted");

  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({ ...base, trust: "trusted" })),
    /must be appended as untrusted/,
    "external content can never enter the log claiming trust",
  );
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({ ...base, trust: "derived" })),
    /must be appended as untrusted/,
  );
  assert.throws(
    () =>
      assertUserAppendableEvent(
        parseAppendEventBody({ ...base, trust: "untrusted", missionStatus: "completed" }),
      ),
    /Evidence events cannot carry/,
  );

  // The inverted trust rule is scoped to evidence only; control events still require trust.
  assert.throws(
    () =>
      assertUserAppendableEvent(
        parseAppendEventBody({
          ...base,
          type: "node.paused",
          trust: "untrusted",
          nodeId: "00000000-0000-4000-8000-000000000002",
          nodeStatus: "paused",
        }),
      ),
    /control events must be trusted/,
  );
});

test("approval command validates decision and operation identity", () => {
  const base = {
    decision: "accepted",
    resolution: { decision: "accepted" },
    correlationId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "approval-resolution-0001",
  };
  assert.equal(parseResolveApprovalBody(base).decision, "accepted");
  assert.throws(
    () => parseResolveApprovalBody({ ...base, decision: "ignored" }),
    /body.decision/,
  );
});

test("request reader rejects oversized and malformed JSON", async () => {
  await assert.rejects(
    readBoundedJsonBody(
      new Request("https://cardea.test", {
        method: "POST",
        headers: { "content-length": "200" },
        body: "{}",
      }),
      100,
    ),
    /exceeds 100 bytes/,
  );
  await assert.rejects(
    readBoundedJsonBody(
      new Request("https://cardea.test", { method: "POST", body: "not-json" }),
    ),
    /valid JSON/,
  );
});
