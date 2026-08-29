/**
 * Wire shape for the workspace strip: the caller's own recent missions,
 * newest first.
 *
 * This is deliberately the thinnest possible projection of a mission. The
 * strip only needs enough to label a tab and colour its status dot; anything
 * more would put mandate text, authority, or budget on a list endpoint that a
 * board fetches on every mount.
 *
 * The parser is defensive rather than strict. A tab strip is chrome: a single
 * malformed row must cost that one tab, not the whole strip and the board
 * behind it. Rows that cannot be labelled are dropped silently and a value
 * that is not a list at all resolves to no missions.
 */

export type MissionListItem = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

/** Matches `CONTRACT_LIMITS.title`, so a stored title never has to be widened here. */
export const MISSION_LIST_TITLE_LIMIT = 200;

/** Guards against a very long list being pushed at the strip. */
export const MISSION_LIST_MAX_ITEMS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads either the route envelope `{ missions: [...] }` or a bare array.
 *
 * Accepting both keeps the parser usable against the response body and
 * against an already-unwrapped list without a second entry point.
 */
export function parseMissionListResponse(value: unknown): MissionListItem[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.missions)
      ? value.missions
      : null;
  if (!rows) return [];

  const items: MissionListItem[] = [];
  for (const row of rows) {
    if (items.length >= MISSION_LIST_MAX_ITEMS) break;
    if (!isRecord(row)) continue;
    const id = readString(row.id);
    const title = readString(row.title);
    const status = readString(row.status);
    const updatedAt = readString(row.updatedAt);
    if (!id || !title || !status || !updatedAt) continue;
    items.push({
      id,
      title: title.slice(0, MISSION_LIST_TITLE_LIMIT),
      status,
      updatedAt,
    });
  }
  return items;
}
