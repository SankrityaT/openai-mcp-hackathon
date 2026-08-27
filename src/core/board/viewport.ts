/**
 * Pure viewport maths for the Cardea board.
 *
 * The board is an unbounded plane. A `View` is the only thing mapping it onto
 * the screen, and nothing here constrains x/y -- panning is deliberately
 * infinite in every direction. Only `scale` is bounded, because outside these
 * limits the grid stops carrying information.
 *
 * Kept free of React so the invariants below can be tested directly.
 */

export type View = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

/** World units in one micro cell at 100%. */
export const BASE_CELL = 20;
/** Micro cells between heavy rules. Keeps ruler labels on round hundreds. */
export const MAJOR_EVERY = 5;

export function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

export function screenToWorld(view: View, sx: number, sy: number) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

export function worldToScreen(view: View, wx: number, wy: number) {
  return { x: wx * view.scale + view.x, y: wy * view.scale + view.y };
}

/**
 * Zoom about a screen point, keeping the world point under it pinned. This is
 * what makes cursor-anchored zoom feel physical rather than centre-biased.
 */
export function zoomAbout(view: View, factor: number, sx: number, sy: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  if (scale === view.scale) return view;
  const world = screenToWorld(view, sx, sy);
  return { scale, x: sx - world.x * scale, y: sy - world.y * scale };
}

/**
 * Picks the world-space rule spacing whose on-screen size sits in a legible
 * band, so the board keeps readable structure at 5% and at 800%. Stepping by
 * MAJOR_EVERY rather than powers of ten means heavy rules stay on the same
 * world lines across a threshold, so the grid never visibly reshuffles.
 */
export function gridStepFor(scale: number) {
  let step = BASE_CELL;
  while (step * scale < 7) step *= MAJOR_EVERY;
  while (step * scale > 7 * MAJOR_EVERY) step /= MAJOR_EVERY;
  return step;
}

export type Insets = { top?: number; right?: number; bottom?: number; left?: number };

/**
 * Scale and offset that centre a world box in the viewport.
 *
 * `insets` describe chrome that overlaps the board -- a docked composer, a
 * ruler -- so content is centred in the space actually left free rather than
 * in the raw viewport, where it would sit behind the furniture.
 */
export function fitToBox(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding = 120,
  insets: Insets = {},
): View {
  const top = insets.top ?? 0;
  const right = insets.right ?? 0;
  const bottom = insets.bottom ?? 0;
  const left = insets.left ?? 0;

  const free = {
    width: Math.max(1, viewport.width - left - right),
    height: Math.max(1, viewport.height - top - bottom),
  };
  const scale = clamp(
    Math.min(
      (free.width - padding * 2) / Math.max(box.width, 1),
      (free.height - padding * 2) / Math.max(box.height, 1),
    ),
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    x: left + free.width / 2 - (box.x + box.width / 2) * scale,
    y: top + free.height / 2 - (box.y + box.height / 2) * scale,
  };
}
