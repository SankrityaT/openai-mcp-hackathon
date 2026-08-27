/**
 * When a standing mission is due, expressed as pure functions of a schedule
 * and a clock.
 *
 * The sweep that uses these runs on a cron and may fire more than once inside
 * a single scheduled occurrence, so "is it due" is not enough on its own. The
 * unit that matters is the *window*: one scheduled occurrence, identified by
 * `windowKey`, opened at `windowStart`, and considered live for
 * `STANDING_WINDOW_MS` after that. Every id the spawner derives — the mission
 * correlation id, the quota idempotency key, the mandate approval key — is
 * keyed to that window, so a second sweep inside the same window recreates
 * exactly the same ids rather than a second set.
 *
 * Nothing here reads a clock, an environment variable, or a database: `now` is
 * always passed in, which is what makes the whole matrix testable.
 */

export type StandingCadence = "daily" | "weekdays" | "weekly";

export const STANDING_CADENCES: readonly StandingCadence[] = ["daily", "weekdays", "weekly"];

export function isStandingCadence(value: unknown): value is StandingCadence {
  return typeof value === "string" && (STANDING_CADENCES as readonly string[]).includes(value);
}

/** Plain words for each cadence, shared by the API, the panel, and the log. */
export const STANDING_CADENCE_LABELS: Readonly<Record<StandingCadence, string>> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week",
};

/**
 * The schedule half of a standing mission, without the goal, the authority, or
 * anything else the spawner copies onto a run. Deliberately the smallest shape
 * these decisions need.
 */
export type StandingSchedule = {
  id: string;
  cadence: StandingCadence;
  /** 0-23, in UTC. The owner picks a local hour; the API stores UTC. */
  hourUtc: number;
  enabled: boolean;
  /** ISO timestamp. Fixes which weekday a `weekly` schedule runs on. */
  createdAt: string;
  /** ISO timestamp of the start of the last claimed window, or null. */
  lastSpawnedAt: string | null;
};

/**
 * How long after its start a window stays claimable. The sweep runs every 30
 * minutes, so an hour gives every occurrence two chances to be picked up
 * without ever reaching into the next hour's occurrence — cadences here are at
 * most one occurrence per day, so windows can never overlap.
 */
export const STANDING_WINDOW_MS = 60 * 60 * 1000;

/** The cron the sweep is registered on. Kept beside the window it must fit inside. */
export const STANDING_SWEEP_CRON = "*/30 * * * *";

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * The start of the occurrence that belongs to `now`'s UTC date: that date at
 * the schedule's hour. It is a real instant whether or not the schedule runs
 * that day; `isDue` is what decides that.
 */
export function windowStart(schedule: StandingSchedule, now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), schedule.hourUtc, 0, 0, 0),
  );
}

/**
 * Stable identifier for one occurrence: `<id>:<YYYY-MM-DD>T<HH>`. Constant for
 * every instant inside the window, and different for every other occurrence,
 * which is the whole basis of the spawner's idempotency.
 */
export function windowKey(schedule: StandingSchedule, now: Date): string {
  const start = windowStart(schedule, now);
  const date = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
  return `${schedule.id}:${date}T${pad(start.getUTCHours())}`;
}

/** True when this cadence runs on the UTC day `start` falls on. */
function cadenceCoversDay(schedule: StandingSchedule, start: Date): boolean {
  const weekday = start.getUTCDay();
  switch (schedule.cadence) {
    case "daily":
      return true;
    case "weekdays":
      // Monday through Friday in UTC. Sunday is 0, Saturday is 6.
      return weekday >= 1 && weekday <= 5;
    case "weekly": {
      const created = new Date(schedule.createdAt);
      // An unparseable created_at must not silently turn a weekly schedule
      // into a daily one, so it stops being due instead.
      if (Number.isNaN(created.getTime())) return false;
      return weekday === created.getUTCDay();
    }
  }
}

/**
 * Whether this schedule has a live, unclaimed window at `now`.
 *
 * Four things must hold: the owner has it enabled, the cadence covers this UTC
 * day, `now` sits inside the window that opened at the schedule's hour, and no
 * run has already been claimed for that window. The last check is what stops
 * the second sweep of the hour from opening a second mission; the database
 * claim in `claimStandingWindow` is what stops two sweeps that race.
 */
export function isDue(schedule: StandingSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const start = windowStart(schedule, now);
  if (!cadenceCoversDay(schedule, start)) return false;

  const elapsed = now.getTime() - start.getTime();
  if (elapsed < 0 || elapsed >= STANDING_WINDOW_MS) return false;

  if (schedule.lastSpawnedAt === null) return true;
  const last = new Date(schedule.lastSpawnedAt);
  // An unreadable stamp is treated as "already claimed": refusing to run is
  // the safe direction for something that opens missions unattended.
  if (Number.isNaN(last.getTime())) return false;
  return last.getTime() < start.getTime();
}
