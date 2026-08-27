import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_CELL,
  MAJOR_EVERY,
  MAX_SCALE,
  MIN_SCALE,
  type View,
  fitToBox,
  gridStepFor,
  screenToWorld,
  worldToScreen,
  zoomAbout,
} from "./viewport";

const view = (x: number, y: number, scale: number): View => ({ x, y, scale });

test("screen and world coordinates round-trip at any scale", () => {
  for (const scale of [0.05, 0.37, 1, 2.5, 8]) {
    const v = view(-320, 640, scale);
    const world = screenToWorld(v, 811, -197);
    const screen = worldToScreen(v, world.x, world.y);
    assert.ok(Math.abs(screen.x - 811) < 1e-9);
    assert.ok(Math.abs(screen.y - -197) < 1e-9);
  }
});

test("panning is unbounded in every direction", () => {
  // No clamp exists on x/y, so an extreme offset must survive a round-trip.
  const v = view(-9_000_000, 12_500_000, 1);
  const world = screenToWorld(v, 0, 0);
  assert.equal(world.x, 9_000_000);
  assert.equal(world.y, -12_500_000);
  assert.deepEqual(worldToScreen(v, world.x, world.y), { x: 0, y: 0 });
});

test("zoomAbout pins the world point under the cursor", () => {
  const before = view(140, -60, 1);
  const [sx, sy] = [733, 411];
  const anchor = screenToWorld(before, sx, sy);

  const after = zoomAbout(before, 2.5, sx, sy);
  const moved = worldToScreen(after, anchor.x, anchor.y);

  assert.ok(Math.abs(moved.x - sx) < 1e-9, "cursor x drifted");
  assert.ok(Math.abs(moved.y - sy) < 1e-9, "cursor y drifted");
  assert.equal(after.scale, 2.5);
});

test("zoomAbout clamps to the scale bounds and holds the anchor there", () => {
  const zoomedOut = zoomAbout(view(0, 0, 0.06), 0.01, 400, 300);
  assert.equal(zoomedOut.scale, MIN_SCALE);

  const zoomedIn = zoomAbout(view(0, 0, 7), 100, 400, 300);
  assert.equal(zoomedIn.scale, MAX_SCALE);

  // At the bound an identical request must be a no-op, not a slow drift.
  const atMax = zoomAbout(zoomedIn, 100, 400, 300);
  assert.deepEqual(atMax, zoomedIn);
});

test("gridStepFor keeps on-screen spacing inside the legible band", () => {
  for (let scale = MIN_SCALE; scale <= MAX_SCALE; scale *= 1.07) {
    const onScreen = gridStepFor(scale) * scale;
    assert.ok(
      onScreen >= 7 && onScreen <= 7 * MAJOR_EVERY,
      `spacing ${onScreen} out of band at scale ${scale}`,
    );
  }
});

test("grid steps stay aligned to the same world lines across a threshold", () => {
  // Every step is BASE_CELL times a power of MAJOR_EVERY, so heavy rules never
  // land between the rules they replaced.
  for (const scale of [0.05, 0.2, 1, 3, 8]) {
    const ratio = gridStepFor(scale) / BASE_CELL;
    const log = Math.log(ratio) / Math.log(MAJOR_EVERY);
    assert.ok(Math.abs(log - Math.round(log)) < 1e-9, `step ${ratio} is not a power of ${MAJOR_EVERY}`);
  }
});

test("fitToBox centres the box in the viewport", () => {
  const box = { x: -300, y: 120, width: 600, height: 200 };
  const viewport = { width: 1400, height: 900 };
  const fitted = fitToBox(box, viewport);

  const centre = worldToScreen(fitted, box.x + box.width / 2, box.y + box.height / 2);
  assert.ok(Math.abs(centre.x - viewport.width / 2) < 1e-9);
  assert.ok(Math.abs(centre.y - viewport.height / 2) < 1e-9);

  // And the whole box fits, padding included.
  assert.ok(box.width * fitted.scale <= viewport.width);
  assert.ok(box.height * fitted.scale <= viewport.height);
});

test("fitToBox centres inside the free space when chrome overlaps the board", () => {
  const box = { x: 0, y: 0, width: 400, height: 200 };
  const viewport = { width: 1000, height: 800 };
  const bottom = 200;

  const fitted = fitToBox(box, viewport, 60, { bottom });
  const centre = worldToScreen(fitted, box.x + box.width / 2, box.y + box.height / 2);

  // Centred in the 600px tall band above the chrome, not the 800px viewport.
  assert.ok(Math.abs(centre.y - (viewport.height - bottom) / 2) < 1e-9);
  assert.ok(Math.abs(centre.x - viewport.width / 2) < 1e-9);
  // And it must sit clear of the chrome entirely.
  assert.ok(centre.y + (box.height * fitted.scale) / 2 < viewport.height - bottom);
});

test("fitToBox survives a degenerate zero-size box", () => {
  const fitted = fitToBox({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 });
  assert.ok(Number.isFinite(fitted.scale));
  assert.ok(fitted.scale <= MAX_SCALE && fitted.scale >= MIN_SCALE);
});
