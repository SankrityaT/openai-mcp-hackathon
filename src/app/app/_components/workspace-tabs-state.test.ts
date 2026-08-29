import assert from "node:assert/strict";
import test from "node:test";
import type { MissionListItem } from "@/core/contracts/mission-list";
import {
  activateMission,
  activeWorkspaceValue,
  appendDraftTab,
  closeTab,
  DRAFT_TAB_TITLE,
  DRAFT_WORKSPACE,
  deriveWorkspaceTabs,
  missionTabKey,
  promoteActiveTab,
  relabelTabs,
  seedActiveWorkspace,
  seedWorkspaceState,
  selectTab,
  shouldShowStrip,
} from "./workspace-tabs-state";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const GAMMA = "33333333-3333-4333-8333-333333333333";

const MISSIONS: MissionListItem[] = [
  { id: ALPHA, title: "Find a venue", status: "running", updatedAt: "2026-08-29T10:00:00.000Z" },
  { id: BETA, title: "Compare flights", status: "completed", updatedAt: "2026-08-28T10:00:00.000Z" },
];

// --- reload seeding -------------------------------------------------------

test("seedActiveWorkspace prefers the active workspace over the last mission", () => {
  assert.equal(
    seedActiveWorkspace({ activeWorkspace: BETA, lastMissionId: ALPHA }),
    BETA,
  );
});

test("seedActiveWorkspace keeps a resting draft across a reload", () => {
  assert.equal(
    seedActiveWorkspace({ activeWorkspace: DRAFT_WORKSPACE, lastMissionId: ALPHA }),
    DRAFT_WORKSPACE,
  );
});

test("seedActiveWorkspace falls back to the last mission when nothing was active", () => {
  assert.equal(seedActiveWorkspace({ activeWorkspace: null, lastMissionId: ALPHA }), ALPHA);
});

test("seedActiveWorkspace falls back to a draft when both keys are absent", () => {
  assert.equal(
    seedActiveWorkspace({ activeWorkspace: null, lastMissionId: null }),
    DRAFT_WORKSPACE,
  );
});

test("seedActiveWorkspace refuses a malformed id in either key", () => {
  assert.equal(
    seedActiveWorkspace({ activeWorkspace: "../../etc", lastMissionId: "nope" }),
    DRAFT_WORKSPACE,
  );
});

// --- mounting on the seed before the list arrives -------------------------

test("seedWorkspaceState mounts the seeded mission straight away", () => {
  const state = seedWorkspaceState(ALPHA);
  assert.equal(state.activeKey, missionTabKey(ALPHA));
  assert.equal(state.tabs[0].missionId, ALPHA);
});

test("seedWorkspaceState mounts a draft when the seed names no mission", () => {
  const state = seedWorkspaceState(DRAFT_WORKSPACE);
  assert.equal(state.activeKey, "draft-1");
  assert.equal(state.tabs[0].missionId, null);
});

test("the list arriving does not remount the board the seed already opened", () => {
  for (const seed of [ALPHA, DRAFT_WORKSPACE]) {
    assert.equal(
      deriveWorkspaceTabs({ missions: MISSIONS, seed }).activeKey,
      seedWorkspaceState(seed).activeKey,
      `seed ${seed} must derive the same active key before and after the list`,
    );
  }
});

// --- first paint ----------------------------------------------------------

test("deriveWorkspaceTabs opens the seeded mission with no draft tab", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  assert.deepEqual(
    state.tabs.map((tab) => tab.key),
    [missionTabKey(ALPHA), missionTabKey(BETA)],
  );
  assert.equal(state.activeKey, missionTabKey(BETA));
});

test("deriveWorkspaceTabs appends one draft tab when the seed is a draft", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: DRAFT_WORKSPACE });
  assert.equal(state.tabs.length, 3);
  assert.equal(state.activeKey, "draft-1");
  assert.deepEqual(state.tabs[2], {
    key: "draft-1",
    missionId: null,
    title: DRAFT_TAB_TITLE,
    status: "draft",
  });
});

test("deriveWorkspaceTabs falls back to a draft when the seeded mission is gone", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: GAMMA });
  assert.equal(state.activeKey, "draft-1");
  assert.equal(state.tabs.length, 3);
});

test("deriveWorkspaceTabs on an empty list is a single draft", () => {
  const state = deriveWorkspaceTabs({ missions: [], seed: DRAFT_WORKSPACE });
  assert.deepEqual(
    state.tabs.map((tab) => tab.key),
    ["draft-1"],
  );
});

test("shouldShowStrip hides a lone draft with nothing to switch to", () => {
  assert.equal(shouldShowStrip(deriveWorkspaceTabs({ missions: [], seed: DRAFT_WORKSPACE })), false);
});

test("shouldShowStrip shows the strip as soon as a mission is listed", () => {
  assert.equal(shouldShowStrip(deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA })), true);
});

// --- new draft ------------------------------------------------------------

test("appendDraftTab adds a focused draft without disturbing the existing tabs", () => {
  const state = appendDraftTab(deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA }));
  assert.equal(state.activeKey, "draft-1");
  assert.deepEqual(
    state.tabs.map((tab) => tab.key),
    [missionTabKey(ALPHA), missionTabKey(BETA), "draft-1"],
  );
});

test("appendDraftTab never reuses a draft key inside one page load", () => {
  const first = deriveWorkspaceTabs({ missions: [], seed: DRAFT_WORKSPACE });
  const second = appendDraftTab(first);
  const third = appendDraftTab(second);
  assert.deepEqual(
    third.tabs.map((tab) => tab.key),
    ["draft-1", "draft-2", "draft-3"],
  );
});

// --- promotion in place ---------------------------------------------------

test("promoteActiveTab gives the draft its mission and keeps the key", () => {
  const draft = deriveWorkspaceTabs({ missions: [], seed: DRAFT_WORKSPACE });
  const promoted = promoteActiveTab(draft, {
    missionId: ALPHA,
    title: "Find a venue",
    status: "running",
  });
  assert.equal(promoted.activeKey, "draft-1");
  assert.deepEqual(promoted.tabs, [
    { key: "draft-1", missionId: ALPHA, title: "Find a venue", status: "running" },
  ]);
});

test("promoteActiveTab keeps a draft's placeholder title until a real one arrives", () => {
  const draft = deriveWorkspaceTabs({ missions: [], seed: DRAFT_WORKSPACE });
  const promoted = promoteActiveTab(draft, { missionId: ALPHA });
  assert.equal(promoted.tabs[0].title, DRAFT_TAB_TITLE);
  assert.equal(promoted.tabs[0].missionId, ALPHA);
});

test("promoteActiveTab is a no-op once the tab already carries that mission", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA });
  const again = promoteActiveTab(state, {
    missionId: ALPHA,
    title: "Find a venue",
    status: "running",
  });
  assert.equal(again, state);
});

test("promoteActiveTab relabels a mission tab that swapped mission in place", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA });
  const swapped = promoteActiveTab(state, {
    missionId: GAMMA,
    title: "Book the caterer",
    status: "planning",
  });
  assert.equal(swapped.activeKey, missionTabKey(ALPHA));
  assert.deepEqual(swapped.tabs[0], {
    key: missionTabKey(ALPHA),
    missionId: GAMMA,
    title: "Book the caterer",
    status: "planning",
  });
});

test("promoteActiveTab never leaves the same mission on two tabs", () => {
  const state = appendDraftTab(deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA }));
  const promoted = promoteActiveTab(state, {
    missionId: ALPHA,
    title: "Find a venue",
    status: "running",
  });
  assert.deepEqual(
    promoted.tabs.map((tab) => tab.missionId),
    [BETA, ALPHA],
  );
  assert.equal(promoted.activeKey, "draft-1");
});

// --- switching ------------------------------------------------------------

test("activateMission refuses an id the strip has not listed", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  assert.equal(activateMission(state, MISSIONS, GAMMA), null);
});

test("activateMission switches to a mission that already has a tab", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  const next = activateMission(state, MISSIONS, ALPHA);
  assert.equal(next?.activeKey, missionTabKey(ALPHA));
  assert.equal(next?.tabs.length, 2);
});

test("activateMission opens a newly listed mission ahead of the drafts", () => {
  const state = appendDraftTab(deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA }));
  const listed: MissionListItem[] = [
    ...MISSIONS,
    { id: GAMMA, title: "Book the caterer", status: "planning", updatedAt: "2026-08-29T11:00:00.000Z" },
  ];
  const next = activateMission(state, listed, GAMMA);
  assert.deepEqual(next?.tabs.map((tab) => tab.key), [
    missionTabKey(ALPHA),
    missionTabKey(BETA),
    missionTabKey(GAMMA),
    "draft-1",
  ]);
  assert.equal(next?.activeKey, missionTabKey(GAMMA));
});

test("selectTab ignores a key that is not on the strip", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  assert.equal(selectTab(state, "draft-9"), state);
});

test("selectTab moves the active key to an existing tab", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  assert.equal(selectTab(state, missionTabKey(ALPHA)).activeKey, missionTabKey(ALPHA));
});

// --- closing a tab ---------------------------------------------------------

test("closeTab ignores a key that is not on the strip", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  assert.equal(closeTab(state, "draft-9"), state);
});

test("closeTab drops a background tab and leaves the active one alone", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  const next = closeTab(state, missionTabKey(ALPHA));
  assert.equal(next.activeKey, missionTabKey(BETA));
  assert.deepEqual(
    next.tabs.map((tab) => tab.key),
    [missionTabKey(BETA)],
  );
});

test("closeTab on the active tab activates the tab that slides into its place", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA });
  const next = closeTab(state, missionTabKey(ALPHA));
  assert.equal(next.activeKey, missionTabKey(BETA));
});

test("closeTab on the active last tab activates the new last tab", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  const next = closeTab(state, missionTabKey(BETA));
  assert.equal(next.activeKey, missionTabKey(ALPHA));
});

test("closeTab on the only tab opens a fresh draft rather than an empty strip", () => {
  const state = seedWorkspaceState(DRAFT_WORKSPACE);
  const onlyKey = state.tabs[0]!.key;
  const next = closeTab(state, onlyKey);
  assert.equal(next.tabs.length, 1);
  assert.equal(next.tabs[0]!.missionId, null);
  assert.notEqual(next.tabs[0]!.key, onlyKey, "a closed draft's key is never reissued");
  assert.equal(next.activeKey, next.tabs[0]!.key);
});

test("closeTab never touches the mission itself, only the strip", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: BETA });
  const next = closeTab(state, missionTabKey(ALPHA));
  // The closed mission is simply absent from the strip; nothing marks it
  // deleted, cancelled, or otherwise touched.
  assert.equal(
    next.tabs.some((tab) => tab.missionId === ALPHA),
    false,
  );
});

// --- storage + relabel ----------------------------------------------------

test("activeWorkspaceValue reports the mission id of the active tab", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA });
  assert.equal(activeWorkspaceValue(state), ALPHA);
});

test("activeWorkspaceValue reports a draft so a reload does not reopen a mission", () => {
  const state = appendDraftTab(deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA }));
  assert.equal(activeWorkspaceValue(state), DRAFT_WORKSPACE);
});

test("relabelTabs refreshes titles and statuses without moving or re-keying tabs", () => {
  const state = appendDraftTab(deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA }));
  const next = relabelTabs(state, [
    { ...MISSIONS[0], title: "Find a venue in Lisbon", status: "waiting" },
    MISSIONS[1],
  ]);
  assert.deepEqual(
    next.tabs.map((tab) => tab.key),
    state.tabs.map((tab) => tab.key),
  );
  assert.equal(next.activeKey, state.activeKey);
  assert.equal(next.tabs[0].title, "Find a venue in Lisbon");
  assert.equal(next.tabs[0].status, "waiting");
  assert.equal(next.tabs[2].title, DRAFT_TAB_TITLE);
});

test("relabelTabs leaves a tab alone when the refetch no longer lists it", () => {
  const state = deriveWorkspaceTabs({ missions: MISSIONS, seed: ALPHA });
  assert.deepEqual(relabelTabs(state, [MISSIONS[0]]).tabs[1], state.tabs[1]);
});
