import type { MissionEventType } from "./types";

/**
 * The four families the activity rail's filter chips group events into.
 * "other" covers catalogue entries that do not belong to any chip, such as
 * mission.* and memory.* events, so they still render in the unfiltered
 * stream without a matching chip.
 */
export type EventFamily = "nodes" | "tools" | "evidence" | "approvals" | "other";

/**
 * Pure classifier behind the rail's filter chips. Nodes covers node.* and
 * dependency.* (a dependency edit is a fact about a node's graph position).
 * Tools covers tool.* and capability.* (discovering a capability is part of
 * the same tool-surface story as running one). Evidence is evidence.* only.
 * Approvals covers approval.* and mandate.* (a mandate revision is a human
 * decision in the same family as an approval).
 */
export function eventFamily(type: string): EventFamily {
  if (type.startsWith("node.") || type.startsWith("dependency.")) return "nodes";
  if (type.startsWith("tool.") || type.startsWith("capability.")) return "tools";
  if (type.startsWith("evidence.")) return "evidence";
  if (type.startsWith("approval.") || type.startsWith("mandate.")) return "approvals";
  return "other";
}

const EVENT_LABELS: Record<MissionEventType, string> = {
  "mission.created": "Mission created",
  "mission.completed": "Mission completed",
  "mission.failed": "Mission failed",
  "mission.cancelled": "Mission cancelled",
  "mission.reverted": "Mission reverted",
  "mandate.proposed": "Mandate proposed",
  "mandate.revised": "Mandate revised",
  "mandate.approved": "Mandate approved",
  "node.planned": "Node planned",
  "node.started": "Node started",
  "node.paused": "Node paused",
  "node.resumed": "Node resumed",
  "node.redirected": "Node redirected",
  "node.completed": "Node completed",
  "node.failed": "Node failed",
  "node.reverted": "Node reverted",
  "capability.discovered": "Capability discovered",
  "tool.requested": "Tool requested",
  "tool.approved": "Tool approved",
  "tool.started": "Tool started",
  "tool.completed": "Tool completed",
  "tool.failed": "Tool failed",
  "evidence.recorded": "Evidence recorded",
  "memory.proposed": "Memory proposed",
  "memory.promoted": "Memory promoted",
  "memory.edited": "Memory edited",
  "memory.forgotten": "Memory forgotten",
  "approval.requested": "Approval requested",
  "approval.resolved": "Approval resolved",
  "approval.expired": "Approval expired",
  "dependency.added": "Dependency added",
  "dependency.removed": "Dependency removed",
  "dependency.rerouted": "Dependency rerouted",
  "checkpoint.created": "Checkpoint created",
  "quota.consumed": "Quota consumed",
  "policy.denied": "Policy denied",
  "security.recorded": "Security recorded",
};

/**
 * Sentence-case, human label for a mission event type. Falls back to the raw
 * type string for anything outside the catalogue, so an unrecognised event
 * still renders instead of disappearing.
 */
export function describeEventType(type: string): string {
  return EVENT_LABELS[type as MissionEventType] ?? type;
}
