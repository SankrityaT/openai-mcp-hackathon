import assert from "node:assert/strict";
import test from "node:test";
import {
  isDue,
  isStandingCadence,
  STANDING_WINDOW_MS,
  windowKey,
  windowStart,
  type StandingCadence,
  type StandingSchedule,
} from "./standing-cadence";

// 2026-08-24 is a Monday, 08-27 a Thursday, 08-29 a Saturday, 08-30 a Sunday.
const MONDAY = "2026-08-24";
const THURSDAY = "2026-08-27";
const SATURDAY = "2026-08-29";
const SUNDAY = "2026-08-30";

function schedule(overrides: Partial<StandingSchedule> = {}): StandingSchedule {
  return {
    id: "standing-1",
    cadence: "daily",
    hourUtc: 9,
    enabled: true,
    createdAt: `${THURSDAY}T09:00:00.000Z`,
    lastSpawnedAt: null,
    ...overrides,
  };
}

function at(date: string, time: string): Date {
  return new Date(`${date}T${time}Z`);
}

test("isStandingCadence accepts only the three cadences", () => {
  for (const value of ["daily", "weekdays", "weekly"]) {
    assert.equal(isStandingCadence(value), true);
  }
  for (const value of ["hourly", "monthly", "", null, 3, undefined]) {
    assert.equal(isStandingCadence(value), false);
  }
});

test("windowStart is the schedule's hour on the UTC date of now", () => {
  const start = windowStart(schedule({ hourUtc: 14 }), at(THURSDAY, "23:59:00.000"));
  assert.equal(start.toISOString(), `${THURSDAY}T14:00:00.000Z`);
});

test("windowKey is stable across the whole window and different on the next day", () => {
  const row = schedule();
  const opening = windowKey(row, at(THURSDAY, "09:00:00.000"));
  const late = windowKey(row, at(THURSDAY, "09:59:59.999"));
  assert.equal(opening, late);
  assert.equal(opening, `standing-1:${THURSDAY}T09`);
  assert.notEqual(opening, windowKey(row, at("2026-08-28", "09:30:00.000")));
});

test("windowKey distinguishes two schedules that share an hour", () => {
  const now = at(THURSDAY, "09:10:00.000");
  assert.notEqual(
    windowKey(schedule({ id: "a" }), now),
    windowKey(schedule({ id: "b" }), now),
  );
});

test("a daily schedule is due at its hour and stays due for the whole window", () => {
  const row = schedule();
  assert.equal(isDue(row, at(THURSDAY, "09:00:00.000")), true);
  assert.equal(isDue(row, at(THURSDAY, "09:30:00.000")), true);
  assert.equal(isDue(row, at(THURSDAY, "09:59:59.999")), true);
});

test("a daily schedule is not due before its hour or after the window closes", () => {
  const row = schedule();
  assert.equal(isDue(row, at(THURSDAY, "08:59:59.999")), false);
  assert.equal(isDue(row, at(THURSDAY, "10:00:00.000")), false);
  assert.equal(isDue(row, at(THURSDAY, "23:00:00.000")), false);
});

test("the window is exactly STANDING_WINDOW_MS long", () => {
  const row = schedule();
  const start = windowStart(row, at(THURSDAY, "09:00:00.000"));
  assert.equal(isDue(row, new Date(start.getTime() + STANDING_WINDOW_MS - 1)), true);
  assert.equal(isDue(row, new Date(start.getTime() + STANDING_WINDOW_MS)), false);
});

test("a weekdays schedule runs Monday through Friday and not at the weekend", () => {
  const row = schedule({ cadence: "weekdays" });
  assert.equal(isDue(row, at(MONDAY, "09:10:00.000")), true);
  assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), true);
  assert.equal(isDue(row, at(SATURDAY, "09:10:00.000")), false);
  assert.equal(isDue(row, at(SUNDAY, "09:10:00.000")), false);
});

test("a weekly schedule runs on the weekday it was created on", () => {
  const row = schedule({ cadence: "weekly", createdAt: `${THURSDAY}T09:00:00.000Z` });
  assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), true);
  assert.equal(isDue(row, at("2026-09-03", "09:10:00.000")), true); // the next Thursday
  assert.equal(isDue(row, at(MONDAY, "09:10:00.000")), false);
  assert.equal(isDue(row, at(SATURDAY, "09:10:00.000")), false);
});

test("a disabled schedule is never due", () => {
  for (const cadence of ["daily", "weekdays", "weekly"] as StandingCadence[]) {
    const row = schedule({ cadence, enabled: false });
    assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), false);
  }
});

test("a window already claimed in this window is not due again", () => {
  const row = schedule({ lastSpawnedAt: `${THURSDAY}T09:00:00.000Z` });
  assert.equal(isDue(row, at(THURSDAY, "09:00:00.000")), false);
  assert.equal(isDue(row, at(THURSDAY, "09:45:00.000")), false);
});

test("a claim from an earlier window does not block the current one", () => {
  const row = schedule({ lastSpawnedAt: "2026-08-26T09:00:00.000Z" });
  assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), true);
});

test("an unreadable created_at stops a weekly schedule rather than running it daily", () => {
  const row = schedule({ cadence: "weekly", createdAt: "not a timestamp" });
  assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), false);
  assert.equal(isDue(row, at(MONDAY, "09:10:00.000")), false);
});

test("an unreadable last_spawned_at is treated as already claimed", () => {
  const row = schedule({ lastSpawnedAt: "not a timestamp" });
  assert.equal(isDue(row, at(THURSDAY, "09:10:00.000")), false);
});

test("hour 0 and hour 23 windows stay inside their own UTC day", () => {
  const midnight = schedule({ hourUtc: 0 });
  assert.equal(isDue(midnight, at(THURSDAY, "00:00:00.000")), true);
  assert.equal(isDue(midnight, at(THURSDAY, "01:00:00.000")), false);

  const lateHour = schedule({ hourUtc: 23 });
  assert.equal(isDue(lateHour, at(THURSDAY, "23:30:00.000")), true);
  assert.equal(isDue(lateHour, at(THURSDAY, "22:59:00.000")), false);
  assert.equal(windowKey(lateHour, at(THURSDAY, "23:30:00.000")), `standing-1:${THURSDAY}T23`);
});
