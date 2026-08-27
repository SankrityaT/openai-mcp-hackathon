/**
 * Derives the one stage label the product shows for a mission.
 *
 * Deliberately ignores `mission.status`. The current backend never advances
 * that column past `"draft"`, so reading it would report a mission as a draft
 * for its entire life. The observable facts are the mandate's approval and the
 * node statuses, and those are what this reads.
 *
 * Pure, total, and dependency-free: it accepts anything snapshot-shaped, never
 * throws, and never reaches for a clock, a network, or React.
 */

import type { NodeStatus } from "./types";

export type MissionStage =
  /** No mission exists in this session yet. */
  | "draft"
  /** A mission exists but its mandate has not been approved. */
  | "awaiting_mandate"
  /** The mandate is approved and the planner has not produced nodes yet. */
  | "planning"
  /** Nodes exist and work is in flight. */
  | "executing"
  /** A node is waiting on a person, or a node failed. */
  | "needs_attention"
  /** Every node finished. */
  | "complete";

/**
 * The subset of a `MissionSnapshot` this derivation reads. Structural on
 * purpose so callers can pass a full snapshot, or a smaller projection, and
 * so no import cycle forms with the data sources.
 */
export type MissionStageInput = {
  mandate?: { approvedAt?: string | null } | null;
  nodes?: readonly { status: NodeStatus }[] | null;
} | null;

/** Stages after which no further committed events are expected. */
export function isTerminalMissionStage(stage: MissionStage): boolean {
  return stage === "complete";
}

export function deriveMissionStage(input?: MissionStageInput): MissionStage {
  if (!input) return "draft";
  if (!input.mandate?.approvedAt) return "awaiting_mandate";

  const nodes = input.nodes ?? [];
  if (nodes.length === 0) return "planning";

  if (nodes.some((node) => node.status === "needs_approval" || node.status === "failed")) {
    return "needs_attention";
  }
  if (nodes.every((node) => node.status === "completed")) return "complete";
  return "executing";
}
