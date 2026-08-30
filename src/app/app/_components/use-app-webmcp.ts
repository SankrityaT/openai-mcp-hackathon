"use client";

import { useCallback, useEffect, useMemo } from "react";
import { passById } from "@/core/board/passes";
import type { MissionListItem } from "@/core/contracts/mission-list";
import type { CardeaWebMCPActions } from "@/webmcp/use-cardea-webmcp";
import { useCardeaWebMCP } from "@/webmcp/use-cardea-webmcp";
import {
  codenameForNode,
  toApprovalSummaries,
  toCardeaDataMode,
  toNodeSummaries,
  toWalletPassSummaries,
} from "@/webmcp/board-mission-actions";
import type { LiveMissionHandle } from "../_data/use-live-mission";
import type { Wallet } from "./wallet/use-wallet";

/**
 * The controls the board hands to Cardea's inbound WebMCP tools: selection,
 * camera focus, and the takeover surface. Defined here rather than in
 * board.tsx so the T7 port fills this file without touching the board.
 */
export type BoardMissionControls = {
  selectedNodeId: string | null;
  /** Returns false for unknown node ids, per the tool contract. */
  focusNode: (nodeId: string) => boolean;
  /** Returns false for unknown node ids. */
  openTakeover: (nodeId: string) => boolean;
  /** Opens the composer scoped to a node codename. */
  openComposer: (codename: string | null) => void;
  /** Opens sanitized https urls as live browser tiles; returns what opened. */
  openPages: (urls: string[]) => string[];
};

/**
 * The workspace strip, as the board sees it.
 *
 * Owned by `BoardMount` rather than by the board: a board is one workspace,
 * and the strip is the thing that holds several. Passing it down this way
 * keeps the board unaware of tabs while still letting an in-page agent switch
 * between them through the same surface a person clicks.
 */
export type BoardWorkspace = {
  /** Refetches, so an agent listing twice sees a mission created in between. */
  listMissions(): Promise<MissionListItem[]>;
  /** Returns false for a mission the strip does not know about. */
  openMission(missionId: string): boolean;
  /**
   * A mission became visible in this tab. Usually a draft that just created
   * one; it is also how a `create_mission` from an already-titled tab gets
   * relabelled, since the live data source swaps that board to the new
   * mission in place rather than opening a second one.
   */
  onMissionAdopted(missionId: string): void;
};

/**
 * Registers Cardea's inbound WebMCP tools against the live /app board.
 *
 * Every action is a thin delegation. The six state-changing tools go straight
 * to the live `MissionDataSource`, so their `dataMode`, `persisted`,
 * `stateVersion`, and `sequence` come from the same server round trip the
 * visible interface reacts to. The two interface-only tools go to the board's
 * own controls, which already return false for a node that is not on canvas.
 *
 * Nothing here simulates a visible effect. `create_mission` opens the mandate
 * sheet only because the board renders the new snapshot, and `redirect_node`
 * opens the composer only after the server accepted the redirect.
 */
export function useAppWebmcp(input: {
  handle: LiveMissionHandle;
  controls: BoardMissionControls;
  workspace?: BoardWorkspace;
  wallet: Wallet;
}) {
  const { handle, controls, workspace, wallet } = input;
  const { dataMode, spine, stage, dataSource, snapshot } = handle;
  const { selectedNodeId, focusNode, openTakeover, openComposer, openPages } = controls;
  const { passes: walletPasses, selectedIds: walletSelectedIds, amounts: walletAmounts, toggle } = wallet;

  // The strip labels a tab from the mission the board actually adopted, never
  // from an optimistic guess about what a create was going to produce.
  const adoptedMissionId = handle.snapshot?.mission.id ?? null;
  useEffect(() => {
    if (adoptedMissionId) workspace?.onMissionAdopted(adoptedMissionId);
  }, [adoptedMissionId, workspace]);

  // The wallet's own toggle silently no-ops on an unknown id; the tool
  // contract needs a real yes/no so a caller can tell a bad id from a change.
  const toggleWalletPass = useCallback(
    (id: string) => {
      if (!passById(id)) return false;
      toggle(id);
      return true;
    },
    [toggle],
  );

  const actions = useMemo<CardeaWebMCPActions>(
    () => ({
      // A board that cannot persist is reported as fixture, never as live.
      dataMode: toCardeaDataMode(dataMode),
      spine,
      stage,
      nodes: toNodeSummaries(spine.nodes),
      // The same pending approvals the board renders, bounded for the tool.
      approvals: toApprovalSummaries(snapshot?.pendingApprovals ?? []),
      wallet: toWalletPassSummaries(walletPasses, walletSelectedIds, walletAmounts),
      toggleWalletPass,
      selectedNodeId: selectedNodeId ?? "",
      createMission: (goal, options) => dataSource.createMission({ goal }, options),
      updateMandate: (instruction, options) =>
        dataSource.updateMandate({ instruction }, options),
      approveMandate: (options) => dataSource.approveMandate(options),
      focusNode,
      redirectNode: async (nodeId, instruction, options) => {
        const result = await dataSource.redirectNode({ nodeId, instruction }, options);
        // Only scope the composer once the redirect actually landed.
        if (result.ok) openComposer(codenameForNode(spine.nodes, nodeId));
        return result;
      },
      setNodeState: (nodeId, action, options) =>
        dataSource.setNodeState({ nodeId, action }, options),
      resolveApproval: (decision, note, options, approvalId) =>
        dataSource.resolveApproval({ decision, note, approvalId }, options),
      openTakeover,
      openPages,
      // Absent on a surface with no workspace strip, which is what keeps the
      // two workspace tools off boards that cannot switch.
      ...(workspace
        ? { listMissions: workspace.listMissions, openMission: workspace.openMission }
        : {}),
    }),
    [
      dataMode,
      spine,
      stage,
      snapshot,
      walletPasses,
      walletSelectedIds,
      walletAmounts,
      toggleWalletPass,
      selectedNodeId,
      dataSource,
      focusNode,
      openTakeover,
      openComposer,
      openPages,
      workspace,
    ],
  );

  useCardeaWebMCP(actions);
}
