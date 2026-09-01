import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MISSION_AUTHORITY, DEFAULT_MISSION_BUDGET_LIMITS } from "./mission-data-source";
import {
  mergeStandingBudget,
  parseCreateStandingMissionBody,
  parseUpdateStandingMissionBody,
  resolveStandingMissionOwner,
  STANDING_MISSION_LIMITS,
} from "./standing-missions";
import { ContractValidationError } from "./validation";

const CARD_ID = "8c4d1a2e-5b6f-4a71-9c3d-2e5f7a1b9c4d";

function body(overrides: Record<string, unknown> = {}) {
  return { goal: "Summarise what changed overnight", cadence: "daily", hourUtc: 7, ...overrides };
}

test("only a signed-in account may own a standing mission", () => {
  const owner = resolveStandingMissionOwner({ kind: "user", userId: "user-1" });
  assert.deepEqual(owner, { ok: true, userId: "user-1" });
});

test("guest, judge, and anonymous principals are refused with 401", () => {
  for (const principal of [
    { kind: "guest" } as const,
    { kind: "judge" } as const,
    { kind: "anonymous" } as const,
    { kind: "user", userId: "" } as const,
  ]) {
    const result = resolveStandingMissionOwner(principal);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection.status, 401);
    assert.equal(result.ok === false && result.rejection.error, "authentication_required");
  }
});

test("a valid body captures the least-authority default and the default budget", () => {
  const parsed = parseCreateStandingMissionBody(body());
  assert.equal(parsed.goal, "Summarise what changed overnight");
  assert.equal(parsed.cadence, "daily");
  assert.equal(parsed.hourUtc, 7);
  assert.deepEqual(parsed.authority, DEFAULT_MISSION_AUTHORITY);
  assert.deepEqual(parsed.budgetLimits, {
    ...DEFAULT_MISSION_BUDGET_LIMITS,
    maxRetries: 2,
    maxWallClockMs: 240_000,
  });
  assert.deepEqual(parsed.selectedContextCardIds, []);
});

test("a standing mission is clamped by the same retry and wall-clock ceilings as the create path", () => {
  // A standing mission runs unattended on a schedule, so an absent wall-clock
  // ceiling is not a smaller version of the feature: it is a run that can never
  // stop itself. `parseCreateMissionBody` guarantees both numbers, and every
  // path that reaches mergeStandingBudget has to guarantee them too.
  for (const parsed of [
    parseCreateStandingMissionBody(body()),
    parseCreateStandingMissionBody(body({ budgetMicrounits: 25_000 })),
    parseCreateStandingMissionBody(body({ budgetMicrounits: 0 })),
  ]) {
    assert.equal(parsed.budgetLimits.maxRetries, 2);
    assert.equal(parsed.budgetLimits.maxWallClockMs, 240_000);
  }
  assert.equal(mergeStandingBudget(undefined).maxWallClockMs, 240_000);
  assert.equal(mergeStandingBudget(null).maxRetries, 2);
});

test("an omitted title is derived from the goal and bounded", () => {
  const parsed = parseCreateStandingMissionBody(body({ goal: "x".repeat(4_000) }));
  assert.ok(parsed.title.length <= STANDING_MISSION_LIMITS.title);
  assert.ok(parsed.title.length > 0);
});

test("an authority override merges over the default rather than replacing it", () => {
  const parsed = parseCreateStandingMissionBody(body({ authority: { freePassage: true } }));
  assert.equal(parsed.authority.freePassage, true);
  // Everything the caller did not name stays at the least-authority default,
  // so a partial override can never quietly drop an approval category.
  assert.deepEqual(
    parsed.authority.requireApprovalCategories,
    DEFAULT_MISSION_AUTHORITY.requireApprovalCategories,
  );
  assert.equal(
    parsed.authority.allowExternalSideEffects,
    DEFAULT_MISSION_AUTHORITY.allowExternalSideEffects,
  );
});

test("a malformed authority override is rejected, not silently ignored", () => {
  assert.throws(
    () => parseCreateStandingMissionBody(body({ authority: { freePassage: "yes" } })),
    ContractValidationError,
  );
  assert.throws(
    () => parseCreateStandingMissionBody(body({ authority: [] })),
    ContractValidationError,
  );
});

test("budgetMicrounits raises only the cost ceiling", () => {
  const parsed = parseCreateStandingMissionBody(body({ budgetMicrounits: 25_000 }));
  assert.equal(parsed.budgetLimits.maxCostMicrounits, 25_000);
  assert.equal(parsed.budgetLimits.maxModelCalls, DEFAULT_MISSION_BUDGET_LIMITS.maxModelCalls);
  assert.throws(
    () => parseCreateStandingMissionBody(body({ budgetMicrounits: -1 })),
    ContractValidationError,
  );
  assert.throws(
    () => parseCreateStandingMissionBody(body({ budgetMicrounits: 1.5 })),
    ContractValidationError,
  );
});

test("the body is rejected when it is not an object", () => {
  for (const value of [null, undefined, "goal", 7, []]) {
    assert.throws(() => parseCreateStandingMissionBody(value), ContractValidationError);
  }
});

test("goal is bounded at both ends", () => {
  assert.throws(() => parseCreateStandingMissionBody(body({ goal: "" })), ContractValidationError);
  assert.throws(
    () => parseCreateStandingMissionBody(body({ goal: "x".repeat(STANDING_MISSION_LIMITS.goal + 1) })),
    ContractValidationError,
  );
});

test("title is bounded", () => {
  assert.throws(
    () => parseCreateStandingMissionBody(body({ title: "x".repeat(STANDING_MISSION_LIMITS.title + 1) })),
    ContractValidationError,
  );
});

test("cadence must be one of the three known values", () => {
  for (const cadence of ["hourly", "monthly", "", 1, null]) {
    assert.throws(
      () => parseCreateStandingMissionBody(body({ cadence })),
      ContractValidationError,
    );
  }
});

test("hourUtc must be a whole hour in range", () => {
  for (const hourUtc of [-1, 24, 9.5, "7", null, undefined]) {
    assert.throws(
      () => parseCreateStandingMissionBody(body({ hourUtc })),
      ContractValidationError,
    );
  }
  assert.equal(parseCreateStandingMissionBody(body({ hourUtc: 0 })).hourUtc, 0);
  assert.equal(parseCreateStandingMissionBody(body({ hourUtc: 23 })).hourUtc, 23);
});

test("selected context card ids must be uuids and are bounded in number", () => {
  const parsed = parseCreateStandingMissionBody(body({ selectedContextCardIds: [CARD_ID] }));
  assert.deepEqual(parsed.selectedContextCardIds, [CARD_ID]);
  assert.throws(
    () => parseCreateStandingMissionBody(body({ selectedContextCardIds: ["not-a-uuid"] })),
    ContractValidationError,
  );
  assert.throws(
    () =>
      parseCreateStandingMissionBody(
        body({
          selectedContextCardIds: Array.from(
            { length: STANDING_MISSION_LIMITS.selectedContextCardIds + 1 },
            () => CARD_ID,
          ),
        }),
      ),
    ContractValidationError,
  );
});

test("a patch may only change enabled", () => {
  assert.deepEqual(parseUpdateStandingMissionBody({ enabled: false }), { enabled: false });
  assert.deepEqual(parseUpdateStandingMissionBody({ enabled: true, cadence: "weekly" }), {
    enabled: true,
  });
  for (const value of [{}, { enabled: "no" }, { enabled: 1 }, null, []]) {
    assert.throws(() => parseUpdateStandingMissionBody(value), ContractValidationError);
  }
});
