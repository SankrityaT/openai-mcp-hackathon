import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSalutation, saluteFor } from "./greeting";

const at = (hour: number) => new Date(2026, 0, 15, hour, 30, 0);

test("the salutation follows the time of day", () => {
  assert.equal(saluteFor(at(2)).greeting, "Late night");
  assert.equal(saluteFor(at(8)).greeting, "Morning");
  assert.equal(saluteFor(at(13)).greeting, "Afternoon");
  assert.equal(saluteFor(at(21)).greeting, "Evening");
});

test("boundaries land on the later greeting", () => {
  assert.equal(saluteFor(new Date(2026, 0, 15, 5, 0)).greeting, "Morning");
  assert.equal(saluteFor(new Date(2026, 0, 15, 12, 0)).greeting, "Afternoon");
  assert.equal(saluteFor(new Date(2026, 0, 15, 17, 0)).greeting, "Evening");
});

test("no name is invented when none is known", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(saluteFor(at(9), value).name, null);
    assert.equal(formatSalutation(saluteFor(at(9), value)), "Morning");
  }
});

test("a known name is trimmed and addressed", () => {
  assert.equal(formatSalutation(saluteFor(at(19), "  Sanki ")), "Evening, Sanki");
});
