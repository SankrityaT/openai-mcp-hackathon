// Note: no `import "server-only"` here — see harness/planner.ts for why
// (the package is not an installed dependency; plain `node --test` cannot
// resolve Next's bundler-only alias). Only called from route handlers this
// harness owns (`/api/agent/**`) and from other server-only harness code.
import type { Actor, AuthorityPolicy, BudgetLimits, JsonValue } from "@/core/contracts/types";
import { inngest } from "./client";

/**
 * Every sender degrades to a typed, visible no-op when Inngest is not
 * configured (no `INNGEST_EVENT_KEY`) instead of throwing or silently
 * fabricating success. Callers must branch on `dispatched`.
 */
export type DispatchResult = { dispatched: true; ids: string[] } | { dispatched: false; reason: "not_configured" };

function inngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY);
}

// --- cardea/mission.requested -----------------------------------------------
//
// Sent once, immediately after a mission (and its mandate version 1 / first
// event) is durably created. Carries everything `planMission` needs to
// compile context and generate a plan; the function itself performs
// capability discovery, it is not passed in.
//
// Call site: `POST /api/missions` route handler, after
// `repository.createMission(...)` resolves, using the returned
// `MissionSnapshot`:
//   - missionId        = snapshot.mission.id
//   - tenantId         = snapshot.mission.id's tenant (tenant.id from ensureUserTenant)
//   - goal              = snapshot.mandate.goal
//   - constraints       = snapshot.mandate.constraints
//   - authority         = snapshot.mandate.authority
//   - selectedContextCardIds = snapshot.mandate.selectedContextCardIds
//   - budgetLimits      = snapshot.mission.budgetLimits
//   - mandateVersion    = snapshot.mandate.version
//   - expectedSequence  = snapshot.latestSequence + 1
//   - actor             = { kind: "user", id: userId }
//   - correlationId     = the same correlationId used for createMission

export type MissionRequestedPayload = {
  missionId: string;
  tenantId: string;
  /** Stable Cardea user identity used to scope Composio and Supermemory. */
  identityId: string;
  goal: string;
  constraints: JsonValue[];
  authority: AuthorityPolicy;
  selectedContextCardIds: string[];
  budgetLimits: BudgetLimits;
  mandateVersion: number;
  expectedSequence: number;
  actor: Actor;
  correlationId: string;
};

export async function sendMissionRequested(payload: MissionRequestedPayload): Promise<DispatchResult> {
  if (!inngestConfigured()) return { dispatched: false, reason: "not_configured" };
  const result = await inngest.send({ name: "cardea/mission.requested", data: payload });
  return { dispatched: true, ids: result.ids };
}

// --- cardea/node.requested ---------------------------------------------------
//
// Sent by `planMission` (via `step.invoke`, not a direct `send`) for each
// planned node. Exposed here for completeness and for any future direct
// dispatch path (e.g. a redirect that re-triggers a single node without a
// full replan). Not currently expected to be called from route files.

export type NodeRequestedPayload = {
  missionId: string;
  tenantId: string;
  identityId: string;
  nodeId: string;
  node: {
    clientId: string;
    codename: string;
    roleLabel: string;
    objective: string;
    capabilityNames: string[];
    capabilityInputs?: Record<string, JsonValue>;
  };
  mandateVersion: number;
  expectedSequence: number;
  authority: AuthorityPolicy;
  budgetLimits: BudgetLimits;
  actor: Actor;
  correlationId: string;
};

export async function sendNodeRequested(payload: NodeRequestedPayload): Promise<DispatchResult> {
  if (!inngestConfigured()) return { dispatched: false, reason: "not_configured" };
  const result = await inngest.send({ name: "cardea/node.requested", data: payload });
  return { dispatched: true, ids: result.ids };
}

// --- cardea/approval.resolved ------------------------------------------------
//
// Sent once a pending approval has been durably resolved, so any suspended
// `waitForApproval` function (`step.waitForEvent`) can resume.
//
// Call site: `POST /api/approvals/:approvalId/resolve` route handler, after
// `repository.resolveApproval(...)` resolves, using the returned
// `MissionApproval`:
//   - approvalId    = approval.id
//   - missionId     = approval.missionId
//   - tenantId      = approval.tenantId
//   - decision      = the resolved `body.decision` ("accepted" | "modified" | "rejected")
//   - resolution    = approval.resolution
//   - actor         = { kind: "user", id: userId }
//   - correlationId = body.correlationId

export type ApprovalResolvedPayload = {
  approvalId: string;
  missionId: string;
  tenantId: string;
  decision: "accepted" | "modified" | "rejected";
  resolution: JsonValue;
  actor: Actor;
  correlationId: string;
};

export async function sendApprovalResolved(payload: ApprovalResolvedPayload): Promise<DispatchResult> {
  if (!inngestConfigured()) return { dispatched: false, reason: "not_configured" };
  const result = await inngest.send({ name: "cardea/approval.resolved", data: payload });
  return { dispatched: true, ids: result.ids };
}
