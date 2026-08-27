import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, StandingMissionRow } from "../database.types";
import type { StandingMissionView } from "../contracts/standing-missions";
import { isDue, type StandingSchedule } from "../policy/standing-cadence";

/**
 * Reads and writes for `standing_missions`.
 *
 * Like `memory-ref-repository.ts`, this module deliberately avoids importing
 * `./database` or the `"server-only"` marker so it stays loadable under plain
 * `node --test`; route handlers translate {@link StandingMissionDatabaseError}
 * into `RedactedDatabaseError` before calling `safeHttpError`.
 *
 * Two different clients call in here and the difference matters:
 *
 *  - the owner's RLS-scoped client for list, toggle, and delete, so another
 *    account's row is invisible rather than forbidden and a foreign id is a
 *    404 without the endpoint saying anything else about it;
 *  - the admin client for the insert (there is no insert policy, by design)
 *    and for the sweep, which runs with no session at all.
 */

export class StandingMissionDatabaseError extends Error {
  readonly code?: string;

  constructor(code?: string) {
    super("The requested standing mission operation could not be completed.");
    this.name = "StandingMissionDatabaseError";
    this.code = code;
  }
}

function fail(error: { code?: string } | null): never {
  throw new StandingMissionDatabaseError(error?.code);
}

type Client = SupabaseClient<Database>;

/** The wire shape. Authority and budget stay server-side; see `StandingMissionView`. */
export function toStandingMissionView(row: StandingMissionRow): StandingMissionView {
  return {
    id: row.id,
    goal: row.goal,
    title: row.title,
    cadence: row.cadence,
    hourUtc: row.hour_utc,
    enabled: row.enabled,
    lastSpawnedAt: row.last_spawned_at,
    lastRunNote: row.last_run_note,
    createdAt: row.created_at,
  };
}

/** The schedule half of a row, for the pure due-window functions. */
export function toStandingSchedule(row: StandingMissionRow): StandingSchedule {
  return {
    id: row.id,
    cadence: row.cadence,
    hourUtc: row.hour_utc,
    enabled: row.enabled,
    createdAt: row.created_at,
    lastSpawnedAt: row.last_spawned_at,
  };
}

export type InsertStandingMissionInput = {
  tenantId: string;
  userId: string;
  goal: string;
  title: string;
  authority: Json;
  budgetLimits: Json;
  selectedContextCardIds: string[];
  cadence: StandingMissionRow["cadence"];
  hourUtc: number;
};

/**
 * Creates a row on behalf of the signed-in owner. `user_id` and `tenant_id`
 * are both server-resolved: nothing a caller sends reaches either column, so a
 * request cannot name another account or another tenant.
 */
export async function insertStandingMission(
  admin: Client,
  input: InsertStandingMissionInput,
): Promise<StandingMissionRow> {
  const result = await admin
    .from("standing_missions")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      goal: input.goal,
      title: input.title,
      authority: input.authority,
      budget_limits: input.budgetLimits,
      selected_context_card_ids: input.selectedContextCardIds,
      cadence: input.cadence,
      hour_utc: input.hourUtc,
      enabled: true,
    })
    .select("*")
    .single();
  if (result.error || !result.data) fail(result.error);
  return result.data as StandingMissionRow;
}

/** The caller's own rows, newest first. RLS is the scope; the filter is belt and braces. */
export async function listStandingMissions(
  client: Client,
  userId: string,
): Promise<StandingMissionRow[]> {
  const result = await client
    .from("standing_missions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (result.error) fail(result.error);
  return (result.data ?? []) as StandingMissionRow[];
}

/**
 * Pauses or resumes one row. Returns null when the id belongs to somebody else
 * or does not exist — the two are indistinguishable on purpose.
 */
export async function setStandingMissionEnabled(
  client: Client,
  input: { id: string; userId: string; enabled: boolean },
): Promise<StandingMissionRow | null> {
  const result = await client
    .from("standing_missions")
    .update({ enabled: input.enabled, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("*")
    .maybeSingle();
  if (result.error) fail(result.error);
  return (result.data as StandingMissionRow | null) ?? null;
}

/** Deletes one row. False means "not yours or not there", never "forbidden". */
export async function deleteStandingMission(
  client: Client,
  input: { id: string; userId: string },
): Promise<boolean> {
  const result = await client
    .from("standing_missions")
    .delete()
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id")
    .maybeSingle();
  if (result.error) fail(result.error);
  return result.data !== null;
}

/**
 * Enabled rows whose window is live and unclaimed at `now`.
 *
 * The hour is narrowed in SQL and the cadence, window, and claim checks are
 * made by {@link isDue} in one place, so the sweep and its tests agree by
 * construction rather than by two parallel implementations.
 */
export async function listDueStandingMissions(
  admin: Client,
  now: Date,
): Promise<StandingMissionRow[]> {
  const result = await admin
    .from("standing_missions")
    .select("*")
    .eq("enabled", true)
    .eq("hour_utc", now.getUTCHours());
  if (result.error) fail(result.error);
  const rows = (result.data ?? []) as StandingMissionRow[];
  return rows.filter((row) => isDue(toStandingSchedule(row), now));
}

/**
 * Claims one window, atomically.
 *
 * This is the single thing that stops two sweeps from opening two missions for
 * the same occurrence. The predicate `last_spawned_at is null or
 * last_spawned_at < windowStart` plus the stamp `last_spawned_at =
 * windowStart` is a compare-and-set on one row, and Postgres serialises
 * concurrent updates to a row, so exactly one caller gets a row back and every
 * other caller gets null.
 *
 * The claim is taken *before* the mission is opened, which makes a run
 * at-most-once per window rather than at-least-once: if the process dies
 * between the claim and the mission, that occurrence is skipped. For something
 * that opens missions unattended, skipping is the right failure direction, and
 * `last_run_note` leaves the skip visible instead of silent.
 */
export async function claimStandingWindow(
  admin: Client,
  input: { id: string; windowStartIso: string },
): Promise<StandingMissionRow | null> {
  const result = await admin
    .from("standing_missions")
    .update({
      last_spawned_at: input.windowStartIso,
      last_run_note: "opening",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("enabled", true)
    .or(`last_spawned_at.is.null,last_spawned_at.lt.${input.windowStartIso}`)
    .select("*")
    .maybeSingle();
  if (result.error) fail(result.error);
  return (result.data as StandingMissionRow | null) ?? null;
}

/**
 * Records how a claimed window actually ended. Never throws into the sweep: a
 * lost note must not turn one skipped run into a failed sweep for everybody
 * else, and the claim stamp — the part that protects correctness — is already
 * durable by this point.
 */
export async function noteStandingRun(
  admin: Client,
  input: { id: string; note: string },
): Promise<void> {
  try {
    await admin
      .from("standing_missions")
      .update({ last_run_note: input.note.slice(0, 200), updated_at: new Date().toISOString() })
      .eq("id", input.id);
  } catch {
    // Best effort by design; see above.
  }
}
