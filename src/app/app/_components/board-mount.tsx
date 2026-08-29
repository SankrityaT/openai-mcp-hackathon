"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MissionListItem } from "@/core/contracts/mission-list";
import { parseMissionListResponse } from "@/core/contracts/mission-list";
import type { BoardWorkspace } from "./use-app-webmcp";
import {
  activateMission,
  activeWorkspaceValue,
  appendDraftTab,
  closeTab,
  DRAFT_WORKSPACE,
  deriveWorkspaceTabs,
  promoteActiveTab,
  relabelTabs,
  seedActiveWorkspace,
  seedWorkspaceState,
  selectTab,
  shouldShowStrip,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";
import { WorkspaceTabs } from "./workspace-tabs";

/**
 * The board is pure client surface: it reads localStorage and measures the
 * viewport before it can draw anything meaningful. Skipping SSR lets it seed
 * its state directly from storage instead of restoring in an effect, which
 * would otherwise flash an empty board and cascade a second render.
 */
const CardeaBoard = dynamic(() => import("./board").then((m) => m.CardeaBoard), {
  ssr: false,
});

/** Which workspace this browser tab is looking at: a mission id, or "draft". */
const ACTIVE_WORKSPACE_KEY = "cardea:activeWorkspace";
/** Written by `useLiveMission` on every snapshot; read here only as a fallback. */
const LAST_MISSION_STORAGE_KEY = "cardea:lastMissionId";

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeActiveWorkspace(value: string) {
  try {
    window.sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, value);
  } catch {
    // Storage can be denied outright. The strip still works for this load.
  }
}

/**
 * Owns the workspace strip and mounts exactly one board underneath it.
 *
 * Switching workspaces REMOUNTS the board, keyed by the tab. That is the
 * design, not an accident: a board owns one live mission data source, one
 * realtime channel, and one adopted snapshot, and remounting is the honest way
 * to swap all three at once rather than mutating a live source underneath a
 * canvas that is already drawn. The cost is that switching away disposes that
 * realtime subscription; the mission itself keeps running server-side and is
 * still listed when the person comes back to it.
 *
 * The one case that must NOT remount is a draft that creates its mission. The
 * tab is promoted in place and keeps its key, so the board that just performed
 * the create keeps the snapshot it received.
 *
 * The seed is read in an effect rather than in a state initialiser: this
 * component still renders on the server, where there is no session storage,
 * and seeding during render would make the first client render disagree with
 * it.
 */
export function BoardMount() {
  // Both of these are seeded lazily and only in the browser. This component
  // still prerenders on the server, where there is no session storage; the
  // first client render is nevertheless identical to it, because the board is
  // `ssr: false` and the strip waits for the list, so both passes paint
  // nothing and hydration has nothing to disagree about.
  const [seed] = useState(() =>
    typeof window === "undefined"
      ? DRAFT_WORKSPACE
      : seedActiveWorkspace({
          activeWorkspace: readStorage(ACTIVE_WORKSPACE_KEY),
          lastMissionId: readStorage(LAST_MISSION_STORAGE_KEY),
        }),
  );
  // Mounts the board on the seed without waiting on the network.
  // `deriveWorkspaceTabs` derives the same active key from the same seed, so
  // the list arriving widens the strip without remounting the board under it.
  const [state, setState] = useState<WorkspaceTabsState | null>(() =>
    typeof window === "undefined" ? null : seedWorkspaceState(seed),
  );
  const [listed, setListed] = useState(false);
  // The last list the strip has seen. Held in a ref as well as driving state
  // so `openMission` can answer synchronously, which its tool contract needs,
  // and so the memoised workspace object does not churn on every refetch and
  // re-register the WebMCP tools.
  const missionsRef = useRef<MissionListItem[]>([]);
  // Set as soon as the person (or an agent) picks a workspace, so the list
  // arriving late relabels the strip instead of overruling that choice.
  const touchedRef = useRef(false);
  // The strip's own state, readable from the workspace callbacks without
  // putting `state` in their dependency list. That identity has to stay stable:
  // it is what `useAppWebmcp` hands to the WebMCP tool surface, and a new
  // object on every relabel would churn the actions the tools read through.
  const stateRef = useRef<WorkspaceTabsState | null>(null);

  const fetchMissions = useCallback(async (signal?: AbortSignal): Promise<MissionListItem[]> => {
    let items: MissionListItem[] = [];
    try {
      const response = await fetch("/api/missions", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      // An anonymous visitor has no workspaces to list. The board still mounts
      // and shows its own access gate; the strip simply has nothing to offer.
      if (response.ok) items = parseMissionListResponse(await response.json());
    } catch {
      items = [];
    }
    missionsRef.current = items;
    return items;
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commit = useCallback((next: WorkspaceTabsState) => {
    touchedRef.current = true;
    stateRef.current = next;
    writeActiveWorkspace(activeWorkspaceValue(next));
    setState(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMissions(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setState((current) => {
        if (!current) return current;
        const next = touchedRef.current
          ? relabelTabs(current, items)
          : deriveWorkspaceTabs({ missions: items, seed });
        writeActiveWorkspace(activeWorkspaceValue(next));
        return next;
      });
      setListed(true);
    });
    return () => controller.abort();
  }, [fetchMissions, seed]);

  const workspace = useMemo<BoardWorkspace>(
    () => ({
      listMissions: () => fetchMissions(),
      openMission: (missionId) => {
        // Answered against the last list rather than against a pending state
        // update, so the tool reports the refusal in the same turn it is asked.
        const current = stateRef.current;
        const next = current ? activateMission(current, missionsRef.current, missionId) : null;
        if (!next) return false;
        commit(next);
        return true;
      },
      onMissionAdopted: (missionId) => {
        const known = missionsRef.current.find((item) => item.id === missionId);
        setState((current) => {
          if (!current) return current;
          const next = promoteActiveTab(current, {
            missionId,
            title: known?.title,
            status: known?.status,
          });
          if (next === current) return current;
          writeActiveWorkspace(activeWorkspaceValue(next));
          return next;
        });
        // A mission created moments ago is not in the last list yet, so the
        // tab is relabelled from a refetch rather than from a guessed title.
        if (!known) {
          void fetchMissions().then((items) =>
            setState((current) => (current ? relabelTabs(current, items) : current)),
          );
        }
      },
    }),
    [commit, fetchMissions],
  );

  const active = state?.tabs.find((tab) => tab.key === state.activeKey) ?? null;
  if (!state || !active) return null;

  return (
    <>
      {listed && shouldShowStrip(state) ? (
        <WorkspaceTabs
          tabs={state.tabs}
          activeKey={state.activeKey}
          onSelect={(key) => commit(selectTab(state, key))}
          onNewWorkspace={() => commit(appendDraftTab(state))}
          onClose={(key) => commit(closeTab(state, key))}
        />
      ) : null}
      <CardeaBoard key={active.key} initialMissionId={active.missionId} workspace={workspace} />
    </>
  );
}
