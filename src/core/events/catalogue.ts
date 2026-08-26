import type { MissionEventType } from "../contracts/types";

export type EventDefinition = {
  family: "mission" | "mandate" | "node" | "capability" | "tool" | "evidence" | "memory" | "approval" | "dependency" | "checkpoint" | "quota" | "policy" | "security";
  materializes: boolean;
  description: string;
};

export const MISSION_EVENT_CATALOGUE: Record<MissionEventType, EventDefinition> = {
  "mission.created": { family: "mission", materializes: true, description: "Creates the mission materialization." },
  "mission.completed": { family: "mission", materializes: true, description: "Marks the mission complete." },
  "mission.failed": { family: "mission", materializes: true, description: "Marks the mission failed." },
  "mission.cancelled": { family: "mission", materializes: true, description: "Marks the mission cancelled." },
  "mission.reverted": { family: "mission", materializes: true, description: "Restores an approved checkpoint without deleting history." },
  "mandate.proposed": { family: "mandate", materializes: false, description: "Records a proposed mandate version." },
  "mandate.revised": { family: "mandate", materializes: true, description: "Moves the mission to a revised mandate version." },
  "mandate.approved": { family: "mandate", materializes: true, description: "Approves the current mandate version." },
  "node.planned": { family: "node", materializes: true, description: "Adds a domain-agnostic mission node." },
  "node.started": { family: "node", materializes: true, description: "Starts a node." },
  "node.paused": { family: "node", materializes: true, description: "Pauses a node." },
  "node.resumed": { family: "node", materializes: true, description: "Resumes a node." },
  "node.redirected": { family: "node", materializes: true, description: "Records a scoped redirect and version change." },
  "node.completed": { family: "node", materializes: true, description: "Completes a node." },
  "node.failed": { family: "node", materializes: true, description: "Marks a node failed." },
  "node.reverted": { family: "node", materializes: true, description: "Restores a node checkpoint without deleting events." },
  "capability.discovered": { family: "capability", materializes: false, description: "Records capability discovery and provenance." },
  "tool.requested": { family: "tool", materializes: false, description: "Records a policy-gated tool request." },
  "tool.approved": { family: "tool", materializes: false, description: "Links an exact approval to a tool request." },
  "tool.started": { family: "tool", materializes: false, description: "Records execution after idempotency reservation." },
  "tool.completed": { family: "tool", materializes: false, description: "Records a bounded, redacted tool result." },
  "tool.failed": { family: "tool", materializes: false, description: "Records a bounded, redacted tool failure." },
  "evidence.recorded": { family: "evidence", materializes: false, description: "Records evidence with provenance and trust." },
  "memory.proposed": { family: "memory", materializes: false, description: "Proposes a memory reference for explicit consent." },
  "memory.promoted": { family: "memory", materializes: false, description: "Promotes an approved memory reference." },
  "memory.edited": { family: "memory", materializes: false, description: "Records a memory version change." },
  "memory.forgotten": { family: "memory", materializes: false, description: "Records forgetting without erasing the audit event." },
  "approval.requested": { family: "approval", materializes: true, description: "Creates a pending approval." },
  "approval.resolved": { family: "approval", materializes: true, description: "Atomically settles a pending approval once." },
  "approval.expired": { family: "approval", materializes: true, description: "Expires an unsettled approval." },
  "dependency.added": { family: "dependency", materializes: true, description: "Adds a typed mission edge." },
  "dependency.removed": { family: "dependency", materializes: true, description: "Removes a materialized edge while preserving history." },
  "dependency.rerouted": { family: "dependency", materializes: true, description: "Replaces a dependency path with explicit cause." },
  "checkpoint.created": { family: "checkpoint", materializes: true, description: "Records a recoverable materialization snapshot." },
  "quota.consumed": { family: "quota", materializes: false, description: "Records an atomic quota or budget debit." },
  "policy.denied": { family: "policy", materializes: false, description: "Records a deterministic policy denial." },
  "security.recorded": { family: "security", materializes: false, description: "Links a redacted security event to mission history." },
};
