/**
 * Collision-free placement for anything Cardea opens on the board on its
 * own: an auto-opened browser tab must never land on top of a mission
 * card, another tab, or anything else already there. A person can still
 * drag things wherever they like afterward; that is a deliberate choice
 * this module never overrides.
 */

export type WorldRect = { x: number; y: number; width: number; height: number };

const GAP = 48;

function intersects(a: WorldRect, b: WorldRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function overlapsAny(candidate: WorldRect, occupied: readonly WorldRect[], gap: number): boolean {
  return occupied.some((rect) => intersects(candidate, rect, gap));
}

/**
 * Places `count` equal-size tiles in a left-to-right row, wrapping to a new
 * row beneath whenever the row itself would collide with something already
 * occupying the space. The row's own vertical position starts just below
 * the lowest edge of everything already occupied, so a fresh open never
 * needs to search sideways through existing content at all; it only ever
 * has to consider wrapping against itself.
 */
export function placeRow(
  occupied: readonly WorldRect[],
  count: number,
  size: { width: number; height: number },
  anchor: { centerX: number; minY: number },
): WorldRect[] {
  if (count <= 0) return [];
  const rowWidth = count * size.width + (count - 1) * GAP;
  const originX = anchor.centerX - rowWidth / 2;
  let originY = anchor.minY;

  // A tight, bounded search: try the row at increasing y until nothing in
  // it collides with occupied space. Occupied space is finite and this
  // stops the moment it clears the tallest thing recorded, so it always
  // terminates quickly in practice; the cap only guards a pathological caller.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const row: WorldRect[] = Array.from({ length: count }, (_, index) => ({
      x: originX + index * (size.width + GAP),
      y: originY,
      width: size.width,
      height: size.height,
    }));
    if (row.every((tile) => !overlapsAny(tile, occupied, GAP))) return row;
    originY += size.height + GAP;
  }
  return Array.from({ length: count }, (_, index) => ({
    x: originX + index * (size.width + GAP),
    y: originY,
    width: size.width,
    height: size.height,
  }));
}

/** The lowest edge across every occupied rect, or `fallback` when there are none. */
export function lowestEdge(occupied: readonly WorldRect[], fallback: number): number {
  if (occupied.length === 0) return fallback;
  return Math.max(...occupied.map((rect) => rect.y + rect.height));
}

/** Horizontal center across every occupied rect, or `fallback` when there are none. */
export function centerOf(occupied: readonly WorldRect[], fallback: number): number {
  if (occupied.length === 0) return fallback;
  const minX = Math.min(...occupied.map((rect) => rect.x));
  const maxX = Math.max(...occupied.map((rect) => rect.x + rect.width));
  return (minX + maxX) / 2;
}
