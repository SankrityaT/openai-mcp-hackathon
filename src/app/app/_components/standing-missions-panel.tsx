"use client";

import { useId, useState, useSyncExternalStore } from "react";
import {
  STANDING_CADENCE_LABELS,
  type StandingCadence,
} from "@/core/policy/standing-cadence";
import styles from "./standing-missions-panel.module.css";

/**
 * The standing missions surface: a quiet list of the schedules a person has
 * already approved, and one small form for approving another.
 *
 * Purely presentational. It fetches nothing, stores nothing, and decides
 * nothing about authority; the control room owns the data and the calls, and
 * passes results in. Everything the panel says about what a run will do is
 * true of what the server actually does: each run opens a mission carrying the
 * authority captured when the schedule was created, and every consequential
 * action still stops for the person on every run.
 */

export type StandingMissionSummary = {
  id: string;
  title: string;
  goal: string;
  cadence: StandingCadence;
  /** 0-23, in UTC, as stored. The panel converts it for display only. */
  hourUtc: number;
  enabled: boolean;
  /** ISO timestamp of the last window a run was claimed for, or null. */
  lastSpawnedAt?: string | null;
  /** How that run ended: "opened", "quota_exhausted", "failed", or null. */
  lastRunNote?: string | null;
};

export type StandingMissionDraft = {
  goal: string;
  title?: string;
  cadence: StandingCadence;
  /** Already converted from the person's local hour by this component. */
  hourUtc: number;
};

export type StandingMissionsPanelProps = {
  standingMissions: StandingMissionSummary[];
  /** Prefills the form from whatever the composer currently holds. */
  defaultGoal?: string;
  defaultTitle?: string;
  /** Disables every control while a request the control room owns is in flight. */
  busy?: boolean;
  onCreate: (draft: StandingMissionDraft) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
};

const CADENCE_OPTIONS: StandingCadence[] = ["daily", "weekdays", "weekly"];
const LOCAL_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Whether the panel is running in the browser yet, without an effect and
 * without a hydration mismatch: the server snapshot is `false`, the client
 * snapshot is `true`, and there is nothing to subscribe to because the answer
 * never changes again after hydration.
 */
const subscribeToNothing = () => () => {};

/**
 * The UTC hour that corresponds to `localHour` on `reference`'s own date.
 *
 * Anchored to a real date rather than a fixed offset so the conversion is the
 * one the browser actually applies today, daylight saving included. It is
 * still only correct for schedules near that date, which is exactly why the
 * copy says "about" rather than promising a wall-clock minute.
 */
export function localHourToUtcHour(localHour: number, reference: Date = new Date()): number {
  const local = new Date(reference);
  local.setHours(localHour, 0, 0, 0);
  return local.getUTCHours();
}

/** The inverse, for showing a stored schedule back in the reader's own hours. */
export function utcHourToLocalHour(hourUtc: number, reference: Date = new Date()): number {
  const utc = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  return utc.getHours();
}

/** "Every day, runs about 07:00 your time". Plain words, no promises. */
export function describeSchedule(
  cadence: StandingCadence,
  hourUtc: number,
  localised: boolean,
  reference: Date = new Date(),
): string {
  const hour = localised ? utcHourToLocalHour(hourUtc, reference) : hourUtc;
  const suffix = localised ? "your time" : "UTC";
  return `${STANDING_CADENCE_LABELS[cadence]}, runs about ${pad(hour)}:00 ${suffix}`;
}

/** Plain words for the note the spawner stamped on the last claimed window. */
export function describeLastRun(summary: StandingMissionSummary): string | null {
  if (!summary.lastSpawnedAt) return null;
  const date = summary.lastSpawnedAt.slice(0, 10);
  switch (summary.lastRunNote) {
    case "opened":
      return `Last opened a mission on ${date}`;
    case "quota_exhausted":
      return `Skipped on ${date}, your daily mission allowance was spent`;
    case "failed":
      return `Did not open on ${date}`;
    default:
      return `Last run window was ${date}`;
  }
}

function excerpt(goal: string, limit = 96): string {
  const collapsed = goal.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

export function StandingMissionsPanel({
  standingMissions,
  defaultGoal,
  defaultTitle,
  busy = false,
  onCreate,
  onToggle,
  onDelete,
}: StandingMissionsPanelProps) {
  const headingId = useId();
  const goalId = useId();
  const cadenceId = useId();
  const hourId = useId();

  // Null means "the person has not typed here yet", so the composer's current
  // goal keeps showing through until they do. No effect syncs a prop into
  // state; the fallback is computed during render instead.
  const [typedGoal, setTypedGoal] = useState<string | null>(null);
  const [cadence, setCadence] = useState<StandingCadence>("daily");
  const [localHour, setLocalHour] = useState(8);

  // Timezone is a browser fact, so it cannot be read during the server render
  // without risking a hydration mismatch. Until the panel is hydrated, stored
  // hours are labelled UTC, which is what they actually are.
  const localised = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const goal = typedGoal ?? defaultGoal ?? "";
  const trimmedGoal = goal.trim();
  const canSubmit = trimmedGoal.length > 0 && !busy;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 className={styles.heading} id={headingId}>
          Standing missions
        </h2>
        <p className={styles.note}>
          Each run opens a mission with the authority you approved here.
          Consequential actions still stop for you every time.
        </p>
      </header>

      {standingMissions.length > 0 ? (
        <ul className={styles.list}>
          {standingMissions.map((summary) => {
            const lastRun = describeLastRun(summary);
            return (
              <li className={styles.item} key={summary.id} data-enabled={summary.enabled}>
                <div className={styles.itemBody}>
                  <p className={styles.itemTitle}>{summary.title}</p>
                  <p className={styles.itemGoal}>{excerpt(summary.goal)}</p>
                  <p className={styles.itemMeta}>
                    {describeSchedule(summary.cadence, summary.hourUtc, localised)}
                  </p>
                  {lastRun ? <p className={styles.itemRun}>{lastRun}</p> : null}
                </div>
                <div className={styles.itemActions}>
                  <label className={styles.toggle}>
                    <input
                      checked={summary.enabled}
                      disabled={busy}
                      onChange={(event) => onToggle(summary.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className={styles.toggleTrack} aria-hidden="true">
                      <span className={styles.toggleThumb} />
                    </span>
                    <span className={styles.toggleLabel}>
                      {summary.enabled ? "On" : "Paused"}
                    </span>
                  </label>
                  <button
                    className={styles.delete}
                    disabled={busy}
                    onClick={() => onDelete(summary.id)}
                    type="button"
                  >
                    Delete
                    <span className={styles.visuallyHidden}> {summary.title}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>No standing missions yet.</p>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onCreate({
            goal: trimmedGoal,
            title: defaultTitle?.trim() ? defaultTitle.trim() : undefined,
            cadence,
            hourUtc: localHourToUtcHour(localHour),
          });
        }}
      >
        <label className={styles.label} htmlFor={goalId}>
          Goal
        </label>
        <textarea
          className={styles.textarea}
          disabled={busy}
          id={goalId}
          onChange={(event) => setTypedGoal(event.target.value)}
          rows={3}
          value={goal}
        />

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={cadenceId}>
              How often
            </label>
            <select
              className={styles.select}
              disabled={busy}
              id={cadenceId}
              onChange={(event) => setCadence(event.target.value as StandingCadence)}
              value={cadence}
            >
              {CADENCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {STANDING_CADENCE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={hourId}>
              Around
            </label>
            <select
              className={styles.select}
              disabled={busy}
              id={hourId}
              onChange={(event) => setLocalHour(Number(event.target.value))}
              value={localHour}
            >
              {LOCAL_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {pad(hour)}:00
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className={styles.timing}>
          {localised
            ? `Runs about ${pad(localHour)}:00 your time.`
            : `Runs about ${pad(localHour)}:00 once this page loads your time zone.`}
        </p>

        <button className={styles.submit} disabled={!canSubmit} type="submit">
          Make it standing
        </button>
      </form>
    </section>
  );
}
