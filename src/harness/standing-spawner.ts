// Relative rather than the `@/` alias for every runtime import: this module is
// compiled by `tsconfig.harness-tests.json` for `node --test`, which emits
// CommonJS without rewriting path aliases, matching the convention in every
// other tested module here.
import { QuotaDeniedError } from "../core/contracts/quota-errors";
import {
  isDue,
  windowKey,
  windowStart,
  type StandingSchedule,
} from "../core/policy/standing-cadence";
import { deterministicUuid } from "./deterministic-id";
import type { StandingMissionRow } from "../core/database.types";
import type {
  Actor,
  AuthorityPolicy,
  BudgetLimits,
  JsonValue,
} from "../core/contracts/types";

/**
 * The sweep that turns a standing mission into an actual mission.
 *
 * Everything here is expressed against injected seams — no Supabase client, no
 * Inngest client, no clock — so the whole thing runs under plain `node --test`
 * with no network. `src/harness/inngest/functions.ts` wires the real
 * repository, the real records module, and the real dispatcher into these
 * seams and nothing else.
 *
 * What a run is, precisely: an ordinary mission, opened with the same goal and
 * a verbatim copy of the authority its owner approved when they created the
 * schedule, with its mandate immediately marked approved and planning
 * dispatched. The standing mandate *is* the standing approval, given once by
 * the human. It is not a widening: the authority copied onto each run is the
 * one they approved, every node-level hard stop and approval gate still fires
 * on every run, and nothing in this file can change either.
 */

/** How a claimed window ended. Stamped on the row so a skip is never silent. */
export type StandingRunNote = "opened" | "quota_exhausted" | "failed";

export type StandingRunOutcome =
  | "opened"
  /** Another sweep already claimed this window. Nothing was opened here. */
  | "already_claimed"
  /** The owner's daily mission allowance is spent. The window is burned, honestly. */
  | "quota_exhausted"
  | "failed";

/**
 * A due standing mission, in the shape the sweep needs. Mapped from the row by
 * {@link toStandingMissionDue} so this module never depends on PostgREST.
 */
export type StandingMissionDue = StandingSchedule & {
  tenantId: string;
  userId: string;
  goal: string;
  title: string;
  authority: AuthorityPolicy;
  budgetLimits: BudgetLimits;
  selectedContextCardIds: string[];
};

export type StandingRunMissionInput = {
  tenantId: string;
  title: string;
  goal: string;
  constraints: JsonValue[];
  authority: AuthorityPolicy;
  selectedContextCardIds: string[];
  budgetLimits: BudgetLimits;
  correlationId: string;
  actor: Actor;
};

export type StandingRunMissionResult = {
  missionId: string;
  tenantId: string;
  mandateVersion: number;
  latestSequence: number;
};

export type StandingSpawnerDeps = {
  /** Enabled rows with a live, unclaimed window at `now`. */
  listDue(now: Date): Promise<StandingMissionDue[]>;
  /** Atomic compare-and-set on the row. False means somebody else has this window. */
  claimWindow(input: { id: string; windowStartIso: string }): Promise<boolean>;
  /** Best-effort record of how the claimed window ended. Must not throw. */
  recordRun(input: { id: string; note: StandingRunNote }): Promise<void>;
  /** The owner's own daily mission allowance. Throws `QuotaDeniedError` when spent. */
  consumeQuota(input: {
    tenantId: string;
    userId: string;
    correlationId: string;
  }): Promise<void>;
  createMission(input: StandingRunMissionInput): Promise<StandingRunMissionResult>;
  /** Appends `mandate.approved` exactly as the events route does. */
  approveMandate(input: {
    missionId: string;
    expectedSequence: number;
    mandateVersion: number;
    actor: Actor;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<{ sequence: number }>;
  dispatchPlanning(input: {
    missionId: string;
    tenantId: string;
    identityId: string;
    goal: string;
    constraints: JsonValue[];
    authority: AuthorityPolicy;
    selectedContextCardIds: string[];
    budgetLimits: BudgetLimits;
    mandateVersion: number;
    expectedSequence: number;
    actor: Actor;
    correlationId: string;
  }): Promise<{ dispatched: boolean }>;
};

export type StandingRunReport = {
  standingId: string;
  windowKey: string;
  outcome: StandingRunOutcome;
  missionId?: string;
  /** False when Inngest is not configured. The mission still exists and is honest about it. */
  planningDispatched?: boolean;
};

export type StandingSweepReport = {
  scanned: number;
  opened: number;
  runs: StandingRunReport[];
};

/** Maps a database row onto the sweep's own vocabulary. */
export function toStandingMissionDue(row: StandingMissionRow): StandingMissionDue {
  return {
    id: row.id,
    cadence: row.cadence,
    hourUtc: row.hour_utc,
    enabled: row.enabled,
    createdAt: row.created_at,
    lastSpawnedAt: row.last_spawned_at,
    tenantId: row.tenant_id,
    userId: row.user_id,
    goal: row.goal,
    title: row.title,
    authority: row.authority as unknown as AuthorityPolicy,
    budgetLimits: row.budget_limits as unknown as BudgetLimits,
    selectedContextCardIds: Array.isArray(row.selected_context_card_ids)
      ? (row.selected_context_card_ids as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

/** `standing:<id>:<window>` — the correlation scheme every derived id hangs off. */
export function standingCorrelationScheme(schedule: StandingSchedule, now: Date): string {
  return `standing:${windowKey(schedule, now)}`;
}

/**
 * The mission correlation id for one window.
 *
 * Deterministic in the window, so a redelivered sweep produces the same uuid,
 * which in turn produces the same `mission-create:<correlationId>` quota
 * idempotency key and the same `mandate.approved` idempotency key. That is the
 * second line of defence behind the row claim: even if two sweeps somehow both
 * got past the claim, the usage ledger's
 * `(tenant, subject, metric, idempotency_key)` uniqueness means the window is
 * debited once rather than twice.
 */
export function standingCorrelationId(schedule: StandingSchedule, now: Date): string {
  return deterministicUuid("standing-mission", standingCorrelationScheme(schedule, now));
}

/** `Title · 2026-08-27`, bounded so it always fits the 200-char mission title. */
export function standingRunTitle(title: string, start: Date): string {
  const date = start.toISOString().slice(0, 10);
  return `${title.slice(0, 160)} · ${date}`;
}

/**
 * The one constraint a standing run adds. It says only what is true: this
 * mission was opened by a schedule the owner set up, not by someone at the
 * keyboard just now.
 */
export function standingConstraint(standingId: string): JsonValue {
  return {
    source: "standing_mission",
    standingId,
    note: "Opened automatically on the schedule its owner approved.",
  };
}

function buildConstraints(due: StandingMissionDue): JsonValue[] {
  return [
    ...due.selectedContextCardIds.map((id) => ({
      contextCard: id,
      source: "visible_context_wallet",
    })),
    standingConstraint(due.id),
  ];
}

/**
 * Opens one due standing mission, or reports why it did not.
 *
 * Order matters: the window is claimed before anything is created. That makes
 * a run at-most-once per window rather than at-least-once, which is the right
 * failure direction for a job that opens missions while nobody is watching.
 */
export async function runStandingMission(
  deps: StandingSpawnerDeps,
  due: StandingMissionDue,
  now: Date,
): Promise<StandingRunReport> {
  const key = windowKey(due, now);
  const start = windowStart(due, now);
  const claimed = await deps.claimWindow({ id: due.id, windowStartIso: start.toISOString() });
  if (!claimed) return { standingId: due.id, windowKey: key, outcome: "already_claimed" };

  const correlationId = standingCorrelationId(due, now);
  // A system actor named for the schedule, so the mission log records that a
  // standing mission opened it and which one, without ever claiming a person
  // was present.
  const actor: Actor = { kind: "system", id: `standing:${due.id}` };

  try {
    await deps.consumeQuota({
      tenantId: due.tenantId,
      userId: due.userId,
      correlationId,
    });
  } catch (error) {
    if (error instanceof QuotaDeniedError) {
      // The window stays claimed. Retrying inside the same window would only
      // hit the same spent allowance, and the note is what makes the skip
      // legible rather than a mission that silently never appeared.
      await deps.recordRun({ id: due.id, note: "quota_exhausted" });
      return { standingId: due.id, windowKey: key, outcome: "quota_exhausted" };
    }
    await deps.recordRun({ id: due.id, note: "failed" });
    throw error;
  }

  try {
    const mission = await deps.createMission({
      tenantId: due.tenantId,
      title: standingRunTitle(due.title, start),
      goal: due.goal,
      constraints: buildConstraints(due),
      // Verbatim. Recurrence copies the approved authority, it never widens it.
      authority: due.authority,
      selectedContextCardIds: due.selectedContextCardIds,
      budgetLimits: due.budgetLimits,
      correlationId,
      actor,
    });

    const approved = await deps.approveMandate({
      missionId: mission.missionId,
      expectedSequence: mission.latestSequence,
      mandateVersion: mission.mandateVersion,
      actor,
      correlationId,
      idempotencyKey: `${standingCorrelationScheme(due, now)}:mandate.approved`,
    });

    const dispatch = await deps.dispatchPlanning({
      missionId: mission.missionId,
      tenantId: mission.tenantId,
      // The owner's Cardea identity, the same one a hand-created mission
      // carries, so memory and connected accounts resolve to the same person.
      identityId: due.userId,
      goal: due.goal,
      constraints: buildConstraints(due),
      authority: due.authority,
      selectedContextCardIds: due.selectedContextCardIds,
      budgetLimits: due.budgetLimits,
      mandateVersion: mission.mandateVersion,
      expectedSequence: approved.sequence,
      actor,
      correlationId,
    });

    await deps.recordRun({ id: due.id, note: "opened" });
    return {
      standingId: due.id,
      windowKey: key,
      outcome: "opened",
      missionId: mission.missionId,
      planningDispatched: dispatch.dispatched,
    };
  } catch (error) {
    await deps.recordRun({ id: due.id, note: "failed" });
    throw error;
  }
}

/**
 * One pass over every due schedule.
 *
 * A single row failing must not take the sweep down with it: one owner's
 * broken schedule cannot be allowed to stop everybody else's. Failures are
 * reported per row and the pass continues.
 */
export async function runStandingSweep(
  deps: StandingSpawnerDeps,
  now: Date,
): Promise<StandingSweepReport> {
  const candidates = await deps.listDue(now);
  const runs: StandingRunReport[] = [];

  for (const due of candidates) {
    // Re-checked here as well as in the query: `listDue` is a seam, and the
    // due rule must hold at the one place that acts on it.
    if (!isDue(due, now)) continue;
    try {
      runs.push(await runStandingMission(deps, due, now));
    } catch {
      runs.push({ standingId: due.id, windowKey: windowKey(due, now), outcome: "failed" });
    }
  }

  return {
    scanned: candidates.length,
    opened: runs.filter((run) => run.outcome === "opened").length,
    runs,
  };
}
