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
  // Known fields pass through; the retry and wall-clock ceilings are always
  // materialized so no mission is created without them.
  assert.deepEqual(parsed.budgetLimits, {
    maxToolCalls: 3,
    maxRetries: 2,
    maxWallClockMs: 300_000,
  });
  assert.throws(
    () => parseCreateMissionBody({ title: "", goal: "Goal", authority }),
    /body.title/,
  );
});

test("budget limits: an empty object still gets retry and wall-clock ceilings", () => {
  const parsed = parseCreateMissionBody({
    title: "Mission",
    goal: "Goal",
    authority,
    budgetLimits: {},
  });
  assert.deepEqual(parsed.budgetLimits, { maxRetries: 2, maxWallClockMs: 300_000 });
});

test("budget limits: oversized and negative values are clamped into range", () => {
  const parsed = parseCreateMissionBody({
    title: "Mission",
    goal: "Goal",
    authority,
    budgetLimits: {
      maxRetries: 9_999,
      maxWallClockMs: 999_999_999_999,
      maxModelCalls: -5,
      maxCostMicrounits: 10_000_000_001,
    },
  });
  assert.deepEqual(parsed.budgetLimits, {
    maxRetries: 10,
    maxWallClockMs: 3_600_000,
    maxModelCalls: 0,
    maxCostMicrounits: 10_000_000_000,
  });
});

test("budget limits: junk fields and non-numeric values are dropped", () => {
  const parsed = parseCreateMissionBody({
    title: "Mission",
    goal: "Goal",
    authority,
    budgetLimits: {
      totallyUnknown: 5,
      maxRetries: "unbounded",
      maxToolCalls: Number.NaN,
      maxModelCalls: 12.9,
    },
  });
  // The junk field vanishes, the string and NaN fall back to defaults or
  // nothing, and the fractional count is floored.
  assert.deepEqual(parsed.budgetLimits, {
    maxModelCalls: 12,
    maxRetries: 2,
    maxWallClockMs: 300_000,
  });
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
    /materialization does not match/,
  );
  // Regression (BE-08 finding): a browser session must not forge a
  // mission/node status through a control event, because guest and judge
  // sessions write via the service-role client that bypasses the DB guard.
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "node.paused",
      nodeId: "00000000-0000-4000-8000-0000000000aa",
      nodeStatus: "paused",
      missionStatus: "completed",
    })),
    /materialization does not match/,
  );
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "node.redirected",
      nodeId: "00000000-0000-4000-8000-0000000000aa",
      nodeStatus: "completed",
    })),
    /materialization does not match/,
  );
  assert.throws(
    () => assertUserAppendableEvent(parseAppendEventBody({
      ...base,
      type: "node.resumed",
      nodeId: "00000000-0000-4000-8000-0000000000aa",
      nodeStatus: "running",
      missionStatus: "completed",
    })),
    /materialization does not match/,
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
    missionId: "11111111-1111-4111-8111-111111111111",
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
