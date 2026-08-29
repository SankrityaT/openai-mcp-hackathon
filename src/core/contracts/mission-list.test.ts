import assert from "node:assert/strict";
import test from "node:test";
import {
  MISSION_LIST_MAX_ITEMS,
  MISSION_LIST_TITLE_LIMIT,
  parseMissionListResponse,
} from "./mission-list";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Find a venue",
  status: "running",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

test("parseMissionListResponse reads the route envelope", () => {
  assert.deepEqual(parseMissionListResponse({ missions: [ROW] }), [ROW]);
});

test("parseMissionListResponse reads a bare array", () => {
  assert.deepEqual(parseMissionListResponse([ROW]), [ROW]);
});

test("parseMissionListResponse preserves the server's order", () => {
  const second = { ...ROW, id: "22222222-2222-4222-8222-222222222222", title: "Compare flights" };
  const parsed = parseMissionListResponse({ missions: [second, ROW] });
  assert.deepEqual(
    parsed.map((item) => item.id),
    [second.id, ROW.id],
  );
});

test("parseMissionListResponse drops rows missing any labelling field", () => {
  const parsed = parseMissionListResponse({
    missions: [
      ROW,
      { ...ROW, id: undefined },
      { ...ROW, title: "" },
      { ...ROW, status: 7 },
      { ...ROW, updatedAt: null },
    ],
  });
  assert.deepEqual(parsed, [ROW]);
});

test("parseMissionListResponse drops non-object rows", () => {
  assert.deepEqual(parseMissionListResponse({ missions: [null, "x", 3, [], ROW] }), [ROW]);
});

test("parseMissionListResponse bounds an overlong title", () => {
  const parsed = parseMissionListResponse({ missions: [{ ...ROW, title: "z".repeat(500) }] });
  assert.equal(parsed[0].title.length, MISSION_LIST_TITLE_LIMIT);
});

test("parseMissionListResponse bounds how many missions a strip will accept", () => {
  const many = Array.from({ length: MISSION_LIST_MAX_ITEMS + 12 }, (_, index) => ({
    ...ROW,
    id: `mission-${index}`,
  }));
  assert.equal(parseMissionListResponse({ missions: many }).length, MISSION_LIST_MAX_ITEMS);
});

test("parseMissionListResponse resolves an empty list to no missions", () => {
  assert.deepEqual(parseMissionListResponse({ missions: [] }), []);
});

test("parseMissionListResponse resolves a non-list to no missions", () => {
  for (const value of [null, undefined, 3, "missions", {}, { missions: {} }, { missions: 1 }]) {
    assert.deepEqual(parseMissionListResponse(value), []);
  }
});

test("parseMissionListResponse invents no fields beyond the tab shape", () => {
  const [item] = parseMissionListResponse({ missions: [{ ...ROW, goal: "secret", authority: {} }] });
  assert.deepEqual(Object.keys(item).sort(), ["id", "status", "title", "updatedAt"]);
});
