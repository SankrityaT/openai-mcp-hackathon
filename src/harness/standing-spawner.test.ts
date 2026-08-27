import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotaDenial, QuotaDeniedError } from "../core/contracts/quota-errors";
import {
  runStandingMission,
  runStandingSweep,
  standingCorrelationId,
  standingCorrelationScheme,
  standingRunTitle,
  type StandingMissionDue,
  type StandingRunNote,
  type StandingSpawnerDeps,
} from "./standing-spawner";
import type { AuthorityPolicy, BudgetLimits } from "../core/contracts/types";

const AUTHORITY: AuthorityPolicy = {
  freePassage: false,
  allowedCapabilityIds: ["cardea.fixture.read"],
  allowedOrigins: [],
  allowedTargets: [],
  allowedRiskLevels: ["low"],
  maxAutonomousCostMicrounits: 0,
  allowExternalSideEffects: false,
  requireApprovalCategories: ["external_write", "payment_or_purchase"],
};

const BUDGET: BudgetLimits = { maxModelCalls: 40, maxToolCalls: 40 };

function due(overrides: Partial<StandingMissionDue> = {}): StandingMissionDue {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    cadence: "daily",
    hourUtc: 9,
    enabled: true,
    createdAt: "2026-08-27T09:00:00.000Z",
    lastSpawnedAt: null,
    tenantId: "tenant-1",
    userId: "user-1",
    goal: "Summarise what changed overnight",
    title: "Morning digest",
    authority: AUTHORITY,
    budgetLimits: BUDGET,
    selectedContextCardIds: [],
    ...overrides,
  };
}

const NOW = new Date("2026-08-27T09:12:00.000Z");
const WINDOW_START = "2026-08-27T09:00:00.000Z";

type Recorded = {
  claims: Array<{ id: string; windowStartIso: string }>;
  notes: Array<{ id: string; note: StandingRunNote }>;
  quota: Array<{ tenantId: string; userId: string; correlationId: string }>;
  missions: Array<Parameters<StandingSpawnerDeps["createMission"]>[0]>;
  approvals: Array<Parameters<StandingSpawnerDeps["approveMandate"]>[0]>;
  dispatches: Array<Parameters<StandingSpawnerDeps["dispatchPlanning"]>[0]>;
};

/**
 * An in-memory double that reproduces the one property the real claim relies
 * on: `last_spawned_at` is only advanced when it is currently null or older
 * than the window being claimed, and the caller learns whether it won. No
 * network, no database, no clock.
 */
function createDeps(
  rows: StandingMissionDue[],
  overrides: Partial<StandingSpawnerDeps> = {},
): { deps: StandingSpawnerDeps; recorded: Recorded } {
  const stamps = new Map<string, string | null>(
    rows.map((row) => [row.id, row.lastSpawnedAt]),
  );
  const recorded: Recorded = {
    claims: [],
    notes: [],
    quota: [],
    missions: [],
    approvals: [],
    dispatches: [],
  };
  let missionCounter = 0;

  const deps: StandingSpawnerDeps = {
    listDue: async () => rows,
    claimWindow: async (input) => {
      recorded.claims.push(input);
      const current = stamps.get(input.id) ?? null;
      if (current !== null && new Date(current).getTime() >= new Date(input.windowStartIso).getTime()) {
        return false;
      }
      stamps.set(input.id, input.windowStartIso);
      return true;
    },
    recordRun: async (input) => {
      recorded.notes.push(input);
    },
    consumeQuota: async (input) => {
      recorded.quota.push(input);
    },
    createMission: async (input) => {
      recorded.missions.push(input);
      missionCounter += 1;
      return {
        missionId: `mission-${missionCounter}`,
        tenantId: input.tenantId,
        mandateVersion: 1,
        latestSequence: 1,
      };
    },
    approveMandate: async (input) => {
      recorded.approvals.push(input);
      return { sequence: input.expectedSequence + 1 };
    },
    dispatchPlanning: async (input) => {
      recorded.dispatches.push(input);
      return { dispatched: true };
    },
    ...overrides,
  };
  return { deps, recorded };
}

test("a due standing mission opens one mission, approves its mandate, and dispatches planning", async () => {
  const { deps, recorded } = createDeps([due()]);
  const report = await runStandingSweep(deps, NOW);

  assert.equal(report.scanned, 1);
  assert.equal(report.opened, 1);
  assert.equal(report.runs[0].outcome, "opened");
  assert.equal(report.runs[0].missionId, "mission-1");
  assert.equal(report.runs[0].planningDispatched, true);
  assert.equal(recorded.missions.length, 1);
  assert.equal(recorded.approvals.length, 1);
  assert.equal(recorded.dispatches.length, 1);
  assert.deepEqual(recorded.notes, [{ id: due().id, note: "opened" }]);
});

test("the window is claimed before anything is created", async () => {
  const { deps, recorded } = createDeps([due()]);
  await runStandingSweep(deps, NOW);
  assert.deepEqual(recorded.claims, [{ id: due().id, windowStartIso: WINDOW_START }]);
});

test("the same window swept twice opens exactly one mission", async () => {
  const row = due();
  const { deps, recorded } = createDeps([row]);

  const first = await runStandingSweep(deps, NOW);
  // The double advances its own stamp on a successful claim, exactly as the
  // database row does, so the second sweep sees a claimed window.
  row.lastSpawnedAt = WINDOW_START;
  const second = await runStandingSweep(deps, new Date("2026-08-27T09:42:00.000Z"));

  assert.equal(first.opened, 1);
  assert.equal(second.opened, 0);
  assert.equal(recorded.missions.length, 1);
  assert.equal(recorded.quota.length, 1);
});

test("a second sweep that reaches the claim anyway is refused by the claim itself", async () => {
  // Same window, same stale in-memory row: only the compare-and-set stands
  // between two sweeps that both believed the window was open.
  const row = due();
  const { deps, recorded } = createDeps([row]);

  const first = await runStandingMission(deps, row, NOW);
  const second = await runStandingMission(deps, row, new Date("2026-08-27T09:55:00.000Z"));

  assert.equal(first.outcome, "opened");
  assert.equal(second.outcome, "already_claimed");
  assert.equal(recorded.missions.length, 1);
  assert.equal(recorded.claims.length, 2);
});

test("the next window is a new window", async () => {
  const row = due({ lastSpawnedAt: WINDOW_START });
  const { deps, recorded } = createDeps([row]);
  const report = await runStandingSweep(deps, new Date("2026-08-28T09:05:00.000Z"));
  assert.equal(report.opened, 1);
  assert.equal(recorded.claims[0].windowStartIso, "2026-08-28T09:00:00.000Z");
});

test("every derived id is keyed to standing:<id>:<window>", async () => {
  const row = due();
  assert.equal(
    standingCorrelationScheme(row, NOW),
    `standing:${row.id}:2026-08-27T09`,
  );
  // Stable inside the window, different in the next one.
  assert.equal(
    standingCorrelationId(row, NOW),
    standingCorrelationId(row, new Date("2026-08-27T09:59:00.000Z")),
  );
  assert.notEqual(
    standingCorrelationId(row, NOW),
    standingCorrelationId(row, new Date("2026-08-28T09:05:00.000Z")),
  );

  const { deps, recorded } = createDeps([row]);
  await runStandingSweep(deps, NOW);
  const correlationId = standingCorrelationId(row, NOW);
  assert.equal(recorded.quota[0].correlationId, correlationId);
  assert.equal(recorded.missions[0].correlationId, correlationId);
  assert.equal(recorded.dispatches[0].correlationId, correlationId);
  assert.equal(
    recorded.approvals[0].idempotencyKey,
    `standing:${row.id}:2026-08-27T09:mandate.approved`,
  );
});

test("a run carries the approved authority verbatim, never a widened one", async () => {
  const { deps, recorded } = createDeps([due()]);
  await runStandingSweep(deps, NOW);
  assert.deepEqual(recorded.missions[0].authority, AUTHORITY);
  assert.deepEqual(recorded.dispatches[0].authority, AUTHORITY);
  assert.deepEqual(recorded.missions[0].budgetLimits, BUDGET);
});

test("a run is opened by a system actor named for its schedule", async () => {
  const row = due();
  const { deps, recorded } = createDeps([row]);
  await runStandingSweep(deps, NOW);
  assert.deepEqual(recorded.missions[0].actor, { kind: "system", id: `standing:${row.id}` });
  assert.deepEqual(recorded.approvals[0].actor, { kind: "system", id: `standing:${row.id}` });
});

test("the constraints say only that a schedule opened this mission", async () => {
  const row = due();
  const { deps, recorded } = createDeps([row]);
  await runStandingSweep(deps, NOW);
  assert.deepEqual(recorded.missions[0].constraints, [
    {
      source: "standing_mission",
      standingId: row.id,
      note: "Opened automatically on the schedule its owner approved.",
    },
  ]);
});

test("selected context cards ride along as their own constraints", async () => {
  const cardId = "8c4d1a2e-5b6f-4a71-9c3d-2e5f7a1b9c4d";
  const { deps, recorded } = createDeps([due({ selectedContextCardIds: [cardId] })]);
  await runStandingSweep(deps, NOW);
  assert.deepEqual(recorded.missions[0].constraints[0], {
    contextCard: cardId,
    source: "visible_context_wallet",
  });
  assert.equal(recorded.missions[0].constraints.length, 2);
  assert.deepEqual(recorded.missions[0].selectedContextCardIds, [cardId]);
});

test("the run title carries the date it was opened", () => {
  assert.equal(
    standingRunTitle("Morning digest", new Date(WINDOW_START)),
    "Morning digest · 2026-08-27",
  );
  assert.ok(standingRunTitle("x".repeat(400), new Date(WINDOW_START)).length <= 200);
});

test("an exhausted allowance skips the run, records the reason, and opens nothing", async () => {
  const { deps, recorded } = createDeps([due()], {
    consumeQuota: async () => {
      throw new QuotaDeniedError(
        buildQuotaDenial({ scope: "user", metric: "mission.created", limit: 25 }),
      );
    },
  });
  const report = await runStandingSweep(deps, NOW);

  assert.equal(report.opened, 0);
  assert.equal(report.runs[0].outcome, "quota_exhausted");
  assert.equal(recorded.missions.length, 0);
  assert.equal(recorded.dispatches.length, 0);
  assert.deepEqual(recorded.notes, [{ id: due().id, note: "quota_exhausted" }]);
});

test("an exhausted allowance keeps the window claimed so the sweep does not retry it", async () => {
  const row = due();
  const { deps, recorded } = createDeps([row], {
    consumeQuota: async () => {
      throw new QuotaDeniedError(buildQuotaDenial({ scope: "user", metric: "mission.created" }));
    },
  });
  await runStandingMission(deps, row, NOW);
  const second = await runStandingMission(deps, row, new Date("2026-08-27T09:40:00.000Z"));
  assert.equal(second.outcome, "already_claimed");
  assert.equal(recorded.notes.length, 1);
});

test("one broken schedule does not stop the rest of the sweep", async () => {
  const broken = due({ id: "22222222-2222-4222-8222-222222222222" });
  const healthy = due();
  const { deps, recorded } = createDeps([broken, healthy], {
    createMission: async (input) => {
      if (input.title.startsWith("Morning digest") && input.tenantId === "tenant-1") {
        // Only the first row fails; distinguished by its correlation id.
        if (input.correlationId === standingCorrelationId(broken, NOW)) {
          throw new Error("database unavailable");
        }
      }
      return {
        missionId: "mission-ok",
        tenantId: input.tenantId,
        mandateVersion: 1,
        latestSequence: 1,
      };
    },
  });

  const report = await runStandingSweep(deps, NOW);
  assert.equal(report.runs.length, 2);
  assert.equal(report.runs[0].outcome, "failed");
  assert.equal(report.runs[1].outcome, "opened");
  assert.deepEqual(recorded.notes[0], { id: broken.id, note: "failed" });
});

test("planning that cannot be dispatched is reported honestly, not as success", async () => {
  const { deps } = createDeps([due()], {
    dispatchPlanning: async () => ({ dispatched: false }),
  });
  const report = await runStandingSweep(deps, NOW);
  assert.equal(report.runs[0].outcome, "opened");
  assert.equal(report.runs[0].planningDispatched, false);
});

test("a schedule that is no longer due is skipped even if the query returned it", async () => {
  const { deps, recorded } = createDeps([due({ enabled: false })]);
  const report = await runStandingSweep(deps, NOW);
  assert.equal(report.runs.length, 0);
  assert.equal(recorded.claims.length, 0);
});
