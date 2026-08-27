"use client";

import type {
  MissionActionResult,
  MissionDataSource,
  MissionSpineNode,
  MissionSpineSummary,
} from "@/core/contracts/mission-data-source";
import {
  MISSION_SPINE_NODE_LIMIT,
  missionActionFailure,
} from "@/core/contracts/mission-data-source";

export type FixtureMissionContext = {
  getNodes(): MissionSpineNode[];
  hasPendingApproval(): boolean;
};

function fixtureResult(
  action: MissionActionResult["action"],
  visibleEffect: string,
  nodeId: string | null = null,
): MissionActionResult {
  return {
    ok: true,
    action,
    dataMode: "fixture",
    persisted: false,
    visibleEffect,
    missionId: null,
    nodeId,
    approvalId: null,
    stateVersion: null,
    sequence: null,
  };
}

/**
 * Representative, local-only implementation of the mission seam.
 *
 * It preserves the canvas behaviour that existed before the live spine and
 * reports `persisted: false` on every result so no caller can mistake a fixture
 * transition for durable mission state.
 */
export function createFixtureMissionDataSource(
  context: FixtureMissionContext,
): MissionDataSource {
  const requireNode = (
    action: MissionActionResult["action"],
    nodeId: string,
  ): MissionActionResult | null =>
    context.getNodes().some((node) => node.id === nodeId)
      ? null
      : missionActionFailure(action, "fixture", {
          code: "unknown_node",
          message: "That node is not on the representative canvas.",
        });

  return {
    mode: "fixture",

    summarize(): MissionSpineSummary {
      return {
        dataMode: "fixture",
        persisted: false,
        missionId: null,
        missionStatus: null,
        mandateVersion: null,
        mandateApproved: null,
        stateVersion: null,
        latestSequence: null,
        nodes: context.getNodes().slice(0, MISSION_SPINE_NODE_LIMIT),
        pendingApprovalIds: [],
      };
    },

    async createMission() {
      return fixtureResult("create_mission", "mandate_opened");
    },

    async approveMandate() {
      return fixtureResult("approve_mandate", "mandate_approved");
    },

    async updateMandate() {
      return fixtureResult("update_mandate", "mandate_opened");
    },

    async redirectNode(input) {
      return (
        requireNode("redirect_node", input.nodeId) ??
        fixtureResult("redirect_node", "scoped_composer_opened", input.nodeId)
      );
    },

    async setNodeState(input) {
      return (
        requireNode("set_node_state", input.nodeId) ??
        fixtureResult("set_node_state", `node_${input.action}`, input.nodeId)
      );
    },

    async resolveApproval(input) {
      return fixtureResult(
        "resolve_approval",
        input.decision === "modify" ? "approval_modify_opened" : "approval_resolved",
      );
    },
  };
}
