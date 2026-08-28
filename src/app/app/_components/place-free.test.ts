import assert from "node:assert/strict";
import test from "node:test";
import { centerOf, lowestEdge, placeRow, type WorldRect } from "./place-free";

function overlaps(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("a placed row never overlaps existing occupied rects", () => {
  const occupied: WorldRect[] = [
    { x: 0, y: 0, width: 240, height: 320 },
    { x: 260, y: 0, width: 240, height: 320 },
    { x: 520, y: 0, width: 240, height: 320 },
  ];
  const row = placeRow(occupied, 3, { width: 580, height: 420 }, { centerX: 380, minY: 320 });
  assert.equal(row.length, 3);
  for (const tile of row) {
    for (const existing of occupied) {
      assert.equal(overlaps(tile, existing), false);
    }
  }
});

test("tiles within one placed row never overlap each other", () => {
  const row = placeRow([], 4, { width: 580, height: 420 }, { centerX: 0, minY: 0 });
  assert.equal(row.length, 4);
  for (let i = 0; i < row.length; i += 1) {
    for (let j = i + 1; j < row.length; j += 1) {
      assert.equal(overlaps(row[i], row[j]), false);
    }
  }
});

test("a second placement clears a first placement at the same anchor", () => {
  const first = placeRow([], 2, { width: 580, height: 420 }, { centerX: 0, minY: 0 });
  const second = placeRow(first, 2, { width: 580, height: 420 }, { centerX: 0, minY: 0 });
  for (const a of first) {
    for (const b of second) {
      assert.equal(overlaps(a, b), false);
    }
  }
});

test("lowestEdge and centerOf read the occupied set honestly", () => {
  const occupied: WorldRect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 200, y: 30, width: 100, height: 100 },
  ];
  assert.equal(lowestEdge(occupied, 999), 130);
  assert.equal(lowestEdge([], 999), 999);
  assert.equal(centerOf(occupied, 0), 150);
  assert.equal(centerOf([], 42), 42);
});

test("count zero places nothing", () => {
  assert.deepEqual(placeRow([{ x: 0, y: 0, width: 10, height: 10 }], 0, { width: 5, height: 5 }, { centerX: 0, minY: 0 }), []);
});
