/**
 * The workspace strip's state, as pure functions.
 *
 * `BoardMount` remounts a whole board per tab, so the one thing that must be
 * exactly right is the tab KEY: it is the React key, and changing it throws
 * away a live mission's realtime channel and its adopted snapshot. Every rule
 * about when a key may change lives here, where it is tested, rather than
 * inside a component that also owns fetching and storage.
 *
 * Two rules carry all the weight:
 *
 *  - a draft tab that creates a mission is PROMOTED in place. It keeps its
 *    key and gains the mission id, so the board is not torn down halfway
 *    through the create it just performed;
 *  - `openMission` refuses an id the strip has not listed. The tools surface
 *    reports that refusal honestly instead of opening an empty tab that
 *    claims to be somebody's mission.
 *
 * This module is free of React, storage, and network access.
 */

import type { MissionListItem } from "@/core/contracts/mission-list";

export type WorkspaceTab = {
  /** Stable React key. `draft-N` until a mission lands, `m-<id>` when listed. */
  key: string;
  /** Null only while the tab is an unsaved draft. */
  missionId: string | null;
  title: string;
  status: string;
};

export type WorkspaceTabsState = {
  tabs: WorkspaceTab[];
  activeKey: string;
};

/** Sentinel stored in `cardea:activeWorkspace` for a tab with no mission yet. */
export const DRAFT_WORKSPACE = "draft";

/** Sentence case, because it is a label a person reads and not a status code. */
export const DRAFT_TAB_TITLE = "New mission";

/** A draft has no server status; the dot reads as neutral. */
export const DRAFT_TAB_STATUS = "draft";

/** Same shape the mission routes accept, so a junk key never becomes a fetch. */
const MISSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

export function missionTabKey(missionId: string): string {
  return `m-${missionId}`;
}

export function draftTabKey(index: number): string {
  return `draft-${index}`;
}

function isDraftTab(tab: WorkspaceTab): boolean {
  return tab.missionId === null;
}

function newDraftTab(tabs: readonly WorkspaceTab[]): WorkspaceTab {
  // Numbering never reuses a retired draft's key inside one page load, so a
  // closed-then-reopened draft cannot inherit a stale board.
  let highest = 0;
  for (const tab of tabs) {
    const match = /^draft-(\d+)$/.exec(tab.key);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return {
    key: draftTabKey(highest + 1),
    missionId: null,
    title: DRAFT_TAB_TITLE,
    status: DRAFT_TAB_STATUS,
  };
}

/**
 * Which workspace a reload should reopen.
 *
 * `cardea:activeWorkspace` wins over `cardea:lastMissionId` on purpose: the
 * mission id is written on every snapshot and never cleared, so a person who
 * deliberately opened a fresh draft and then reloaded would otherwise be
 * dropped back into the mission they had just stepped away from.
 */
export function seedActiveWorkspace(input: {
  activeWorkspace: string | null;
  lastMissionId: string | null;
}): string {
  const { activeWorkspace, lastMissionId } = input;
  if (activeWorkspace === DRAFT_WORKSPACE) return DRAFT_WORKSPACE;
  if (activeWorkspace && MISSION_ID_PATTERN.test(activeWorkspace)) return activeWorkspace;
  if (lastMissionId && MISSION_ID_PATTERN.test(lastMissionId)) return lastMissionId;
  return DRAFT_WORKSPACE;
}

/**
 * The strip before the mission list has arrived: just the one workspace the
 * seed names.
 *
 * This exists so the board mounts on the seed rather than waiting on a fetch,
 * and it is only sound because tab keys are derived from the seed the same way
 * in both places: `deriveWorkspaceTabs` given the same seed produces the same
 * active key, so the reconciliation that follows adds the sibling tabs without
 * remounting the board that is already running.
 */
export function seedWorkspaceState(seed: string): WorkspaceTabsState {
  if (seed === DRAFT_WORKSPACE) {
    const draft = newDraftTab([]);
    return { tabs: [draft], activeKey: draft.key };
  }
  const key = missionTabKey(seed);
  return {
    tabs: [{ key, missionId: seed, title: DRAFT_TAB_TITLE, status: DRAFT_TAB_STATUS }],
    activeKey: key,
  };
}

function toTab(mission: MissionListItem): WorkspaceTab {
  return {
    key: missionTabKey(mission.id),
    missionId: mission.id,
    title: mission.title,
    status: mission.status,
  };
}

/**
 * The strip on first paint: every listed mission, plus one draft tab when the
 * seed asks for a draft or names a mission the list does not contain (deleted,
 * or belonging to a session that has since ended).
 */
export function deriveWorkspaceTabs(input: {
  missions: readonly MissionListItem[];
  seed: string;
}): WorkspaceTabsState {
  const tabs = input.missions.map(toTab);
  const seeded = tabs.find((tab) => tab.missionId === input.seed);
  if (seeded) return { tabs, activeKey: seeded.key };
  const draft = newDraftTab(tabs);
  return { tabs: [...tabs, draft], activeKey: draft.key };
}

/** The "+" tab: one more empty workspace, focused. */
export function appendDraftTab(state: WorkspaceTabsState): WorkspaceTabsState {
  const draft = newDraftTab(state.tabs);
  return { tabs: [...state.tabs, draft], activeKey: draft.key };
}

/** Clicking a tab. An unknown key leaves the strip exactly as it was. */
export function selectTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, activeKey: key };
}

/**
 * `open_mission`, and the strip's own switch-by-id.
 *
 * Returns null when the id is not among the missions the strip has listed,
 * which is what the tool reports as `unknown_mission`. A known mission with no
 * tab yet (listed after the strip was built) opens one, inserted ahead of the
 * drafts so the "+" tab stays last.
 */
export function activateMission(
  state: WorkspaceTabsState,
  missions: readonly MissionListItem[],
  missionId: string,
): WorkspaceTabsState | null {
  const existing = state.tabs.find((tab) => tab.missionId === missionId);
  if (existing) return { ...state, activeKey: existing.key };

  const mission = missions.find((item) => item.id === missionId);
  if (!mission) return null;

  const tab = toTab(mission);
  const firstDraft = state.tabs.findIndex(isDraftTab);
  const tabs =
    firstDraft === -1
      ? [...state.tabs, tab]
      : [...state.tabs.slice(0, firstDraft), tab, ...state.tabs.slice(firstDraft)];
  return { tabs, activeKey: tab.key };
}

/**
 * A mission became visible in the active tab.
 *
 * The key is deliberately left alone. A draft's board has already adopted the
 * mission it just created, and re-keying it here would remount that board and
 * drop the snapshot and realtime channel it is holding.
 *
 * The active tab may already carry a different mission: the live data source
 * swaps an adopted board to a newly created mission in place rather than
 * opening a second one. That is treated as a relabel of this tab, and any
 * other tab that was showing the arriving mission is folded away so the strip
 * never lists the same mission twice.
 */
export function promoteActiveTab(
  state: WorkspaceTabsState,
  mission: { missionId: string; title?: string; status?: string },
): WorkspaceTabsState {
  const active = state.tabs.find((tab) => tab.key === state.activeKey);
  if (!active) return state;
  if (
    active.missionId === mission.missionId &&
    (mission.title === undefined || mission.title === active.title) &&
    (mission.status === undefined || mission.status === active.status)
  ) {
    return state;
  }

  const promoted: WorkspaceTab = {
    key: active.key,
    missionId: mission.missionId,
    title: mission.title ?? (active.missionId === null ? DRAFT_TAB_TITLE : active.title),
    status: mission.status ?? active.status,
  };
  const tabs = state.tabs
    .filter((tab) => tab.key === active.key || tab.missionId !== mission.missionId)
    .map((tab) => (tab.key === active.key ? promoted : tab));
  return { tabs, activeKey: active.key };
}

/**
 * Fresh titles and statuses from a refetch, applied without disturbing tab
 * order, tab keys, or which tab is active. Missions the strip has never opened
 * are not added here; that is `deriveWorkspaceTabs`' and `activateMission`'s job.
 */
export function relabelTabs(
  state: WorkspaceTabsState,
  missions: readonly MissionListItem[],
): WorkspaceTabsState {
  const byId = new Map(missions.map((mission) => [mission.id, mission]));
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      const mission = tab.missionId ? byId.get(tab.missionId) : undefined;
      return mission ? { ...tab, title: mission.title, status: mission.status } : tab;
    }),
  };
}

/**
 * Closing a tab. This only ever removes a row from the strip: the mission
 * itself is never touched, and it keeps running server-side exactly as the
 * module comment on `BoardMount` already promises for switching away from
 * one. An unknown key leaves the strip exactly as it was.
 *
 * The active tab is the only case that needs a decision about where focus
 * lands, because it is the only tab actually mounted (`BoardMount` renders
 * one `CardeaBoard`, keyed by `activeKey`); closing any other tab changes
 * nothing about what is on screen. The rule is the same one a browser tab
 * strip uses: the tab that slides into the closed one's place, or the new
 * last tab when the closed one was last. Closing the very last tab leaves
 * nothing to slide in, so a fresh draft opens rather than an empty strip.
 */
export function closeTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index === -1) return state;

  const remaining = state.tabs.filter((tab) => tab.key !== key);

  if (state.activeKey !== key) {
    return { tabs: remaining, activeKey: state.activeKey };
  }

  if (remaining.length === 0) {
    // Numbered against the tab just closed, not against the now-empty
    // remaining list, or a lone draft closed and reopened would get back
    // its own retired key.
    const draft = newDraftTab(state.tabs);
    return { tabs: [draft], activeKey: draft.key };
  }

  const next = state.tabs[index + 1] ?? remaining[remaining.length - 1];
  return { tabs: remaining, activeKey: next.key };
}

/** What `cardea:activeWorkspace` should hold for the active tab. */
export function activeWorkspaceValue(state: WorkspaceTabsState): string {
  const active = state.tabs.find((tab) => tab.key === state.activeKey);
  return active?.missionId ?? DRAFT_WORKSPACE;
}

/**
 * A lone draft and nothing else is not a choice between workspaces, so the
 * strip stays out of the way until there is something to switch to.
 */
export function shouldShowStrip(state: WorkspaceTabsState): boolean {
  return state.tabs.length > 1 || state.tabs.some((tab) => tab.missionId !== null);
}
