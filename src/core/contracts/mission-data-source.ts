/**
 * Client-side mission data source seam.
 *
 * One narrow interface with two implementations:
 *
 * - fixture: local, representative, never persisted;
 * - live: HTTP round trips to the Cardea mission routes.
 *
 * Callers (canvas controls, WebMCP tools) never branch on transport. They read
 * `dataMode` and `persisted` from the returned result and describe reality.
 */

import type { CardeaDataMode } from "./data-mode";
import type { QuotaDenial } from "./quota-errors";
import type { AuthorityPolicy, BudgetLimits, MissionStatus } from "./types";
import {
  DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  DEFAULT_SAFE_CAPABILITY_IDS,
  DEFAULT_SAFE_CAPABILITY_ORIGINS,
} from "./safe-capabilities";

export type MissionActionName =
  | "create_mission"
  | "approve_mandate"
  | "update_mandate"
  | "redirect_node"
  | "set_node_state"
  | "resolve_approval";

export type NodeControlAction = "pause" | "resume" | "retry" | "revert";

export type ApprovalDecision = "accept" | "modify" | "reject";

export type MissionActionFailureCode =
  | "unauthenticated"
  | "no_active_mission"
  | "unknown_node"
  | "no_pending_approval"
  | "approval_not_found"
  | "quota_denied"
  | "stale_state"
  | "invalid_request"
  | "policy_denied"
  | "not_supported"
  | "server_unavailable";

export type MissionActionFailure = {
  code: MissionActionFailureCode;
  message: string;
  denial?: QuotaDenial;
};

export type MissionActionResult = {
  ok: boolean;
  action: MissionActionName;
  /** Truthful mode this action actually ran in. */
  dataMode: CardeaDataMode;
  /** True only when the Cardea server committed the change. */
  persisted: boolean;
  /** What the human can see happen in the canvas. */
  visibleEffect: string;
  missionId: string | null;
  nodeId: string | null;
  approvalId: string | null;
  /** Server mission state version; null in fixture mode. */
  stateVersion: number | null;
  /** Committed event sequence; null in fixture mode. */
  sequence: number | null;
  failure?: MissionActionFailure;
};

export type MissionSpineNode = {
  id: string;
  codename: string;
  roleLabel: string;
  status: string;
};

export type MissionSpineSummary = {
  dataMode: CardeaDataMode;
  persisted: boolean;
  missionId: string | null;
  missionStatus: MissionStatus | null;
  mandateVersion: number | null;
  mandateApproved: boolean | null;
  stateVersion: number | null;
  latestSequence: number | null;
  nodes: MissionSpineNode[];
  pendingApprovalIds: string[];
};

export type MissionActionOptions = { signal?: AbortSignal };

export interface MissionDataSource {
  readonly mode: CardeaDataMode;
  /** Bounded read-only description of the current mission spine. */
  summarize(): MissionSpineSummary;
  createMission(
    input: {
      goal: string;
      title?: string;
      selectedContextCardIds?: string[];
      freePassage?: boolean;
      /** Wallet spending boundary in micro-units; implementations may ignore it. */
      budgetMicrounits?: number;
    },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  approveMandate(options?: MissionActionOptions): Promise<MissionActionResult>;
  updateMandate(
    input: { instruction: string },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  /**
   * Revises the visible mandate's free-passage authority before approval, so
   * the sheet's toggle applies to the mission it is shown for rather than
   * silently leaking into the next one. Same review discipline as
   * `updateMandate`: a mandate revision the person still approves explicitly.
   */
  setFreePassage(
    input: { enabled: boolean },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  redirectNode(
    input: { nodeId: string; instruction: string },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  setNodeState(
    input: { nodeId: string; action: NodeControlAction },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  /**
   * Settles one pending approval. `approvalId` names which one, and is required
   * in practice whenever more than one approval is pending; omitting it settles
   * the oldest pending approval, which is only unambiguous when there is one.
   * A named approval that is not pending fails with `approval_not_found` rather
   * than settling a different decision than the person made.
   */
  resolveApproval(
    input: { decision: ApprovalDecision; note?: string; approvalId?: string },
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
}

export const MISSION_SPINE_NODE_LIMIT = 20;

/**
 * Least-authority default mandate for a mission created from a bare goal.
 * Deliberately domain-agnostic: Cardea's reviewed read-only capabilities run
 * within the mandate, and exactly two reviewed write capabilities are admitted
 * only through `approvalGatedCapabilityIds`, which stops each of them at the
 * approval hinge on every attempt. The user still approves this mandate in the
 * visible sheet, and every consequential category remains a hard stop.
 */
export const DEFAULT_MISSION_AUTHORITY: AuthorityPolicy = {
  freePassage: false,
  allowedCapabilityIds: [
    ...DEFAULT_SAFE_CAPABILITY_IDS,
    ...DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  ],
  allowedOrigins: [...DEFAULT_SAFE_CAPABILITY_ORIGINS],
  allowedTargets: [
    ...DEFAULT_SAFE_CAPABILITY_IDS,
    ...DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  ],
  approvalGatedCapabilityIds: [...DEFAULT_APPROVAL_GATED_CAPABILITY_IDS],
  // Unchanged: the mandate still authorizes only low-risk work autonomously,
  // and still refuses to treat an external side effect as autonomous.
  allowedRiskLevels: ["low"],
  maxAutonomousCostMicrounits: 0,
  allowExternalSideEffects: false,
  requireApprovalCategories: [
    "external_write",
    "payment_or_purchase",
    "legal_agreement_or_signature",
    "account_credential_or_permission_change",
    "sensitive_outbound_message",
    "destructive_deletion",
    "protected_personal_data_disclosure",
  ],
};

export const DEFAULT_MISSION_BUDGET_LIMITS: BudgetLimits = {
  maxModelCalls: 40,
  maxToolCalls: 40,
  maxRetries: 2,
  maxConcurrentWorkers: 5,
  maxCostMicrounits: 0,
};

const TITLE_LIMIT = 120;

/** Derives a bounded, domain-neutral mission title from a free-form goal. */
export function deriveMissionTitle(goal: string): string {
  const collapsed = goal.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "Untitled mission";
  if (collapsed.length <= TITLE_LIMIT) return collapsed;
  return `${collapsed.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

export function missionActionFailure(
  action: MissionActionName,
  dataMode: CardeaDataMode,
  failure: MissionActionFailure,
  overrides: Partial<MissionActionResult> = {},
): MissionActionResult {
  return {
    ok: false,
    action,
    dataMode,
    persisted: false,
    visibleEffect: "none",
    missionId: null,
    nodeId: null,
    approvalId: null,
    stateVersion: null,
    sequence: null,
    failure,
    ...overrides,
  };
}
