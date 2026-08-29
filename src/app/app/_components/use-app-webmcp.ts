"use client";

import { useMemo } from "react";
import type { CardeaWebMCPActions } from "@/webmcp/use-cardea-webmcp";
import { useCardeaWebMCP } from "@/webmcp/use-cardea-webmcp";
import {
  codenameForNode,
  toApprovalSummaries,
  toCardeaDataMode,
  toNodeSummaries,
} from "@/webmcp/board-mission-actions";
import type { LiveMissionHandle } from "../_data/use-live-mission";

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
};

/**
 * Registers Cardea's 8 inbound WebMCP tools against the live /app board.
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
}) {
  const { handle, controls } = input;
  const { dataMode, spine, stage, dataSource, snapshot } = handle;
  const { selectedNodeId, focusNode, openTakeover, openComposer } = controls;

  const actions = useMemo<CardeaWebMCPActions>(
    () => ({
      // A board that cannot persist is reported as fixture, never as live.
      dataMode: toCardeaDataMode(dataMode),
      spine,
      stage,
      nodes: toNodeSummaries(spine.nodes),
      // The same pending approvals the board renders, bounded for the tool.
      approvals: toApprovalSummaries(snapshot?.pendingApprovals ?? []),
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
    }),
    [
      dataMode,
      spine,
      stage,
      snapshot,
      selectedNodeId,
      dataSource,
      focusNode,
      openTakeover,
      openComposer,
    ],
  );

  useCardeaWebMCP(actions);
}
