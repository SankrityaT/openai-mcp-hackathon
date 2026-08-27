import type { BudgetLimits, JsonValue, MissionApproval, MissionEvent, RiskLevel, TrustLevel } from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";

export type ModelTier = "terra" | "sol";

export type ModelEscalationSignals = {
  validationFailures: number;
  dependencyDepth: number;
  conflictingConstraints: number;
  riskLevel: RiskLevel;
  toolFailures: number;
  evaluatorScore?: number;
};

export type CompiledContext = {
  system: string;
  prompt: string;
  estimatedInputTokens: number;
  includedEvidenceIds: string[];
  includedMemoryIds: string[];
  cacheKey: string;
};

export type ContextEvidence = {
  id: string;
  summary: string;
  provenance: string;
  trust: TrustLevel;
  bytes: number;
  relevance: number;
};

export type ContextMemory = {
  id: string;
  summary: string;
  contextCardId?: string;
  relevance: number;
};

export type PlanningInput = {
  goal: string;
  constraints: JsonValue[];
  authoritySummary: string;
  capabilities: NormalizedCapability[];
  evidence?: ContextEvidence[];
  memories?: ContextMemory[];
  selectedContextCardIds?: string[];
  budget?: BudgetLimits;
  escalation?: ModelEscalationSignals;
};

export type PlannedNode = {
  clientId: string;
  codename: string;
  roleLabel: string;
  objective: string;
  capabilityNames: string[];
  /** Model-produced inputs keyed by exact capability name. */
  capabilityInputs?: Record<string, JsonValue>;
  /**
   * Real-world money in micro-USD (1 USD = 1,000,000) this step would COMMIT
   * if it executed: 0 for research, reading, comparison, and drafting, and
   * nonzero only when the objective inherently commits money. An estimate
   * used to gate the step against the wallet ceiling, never a charge.
   * Optional in the domain shape so plans predating the field still parse;
   * absent reads as 0.
   */
  estimatedCostMicrounits?: number;
  dependsOn: string[];
};

export type MissionPlan = {
  title: string;
  summary: string;
  nodes: PlannedNode[];
  approvalBoundaries: string[];
};

export type CapabilityRisk = {
  level: RiskLevel;
  categories: string[];
};

export type NormalizedCapability = {
  id: string;
  provider: string;
  name: string;
  description: string;
  inputSchema: JsonValue;
  outputSchema?: JsonValue;
  risk: CapabilityRisk;
  trust: { level: TrustLevel; origin?: string; provenance?: string };
  readOnly: boolean;
};

export type CapabilityExecutionRequest = {
  capabilityId: string;
  missionId: string;
  nodeId?: string;
  input: JsonValue;
  correlationId: string;
  idempotencyKey: string;
};

export type CapabilityExecutionResult = {
  executionId: string;
  output: JsonValue;
  summary: string;
  provenance: string;
  trust: TrustLevel;
};

export interface CapabilityAdapter {
  readonly provider: string;
  discover(): Promise<NormalizedCapability[]>;
  execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult>;
  cancel?(executionId: string): Promise<void>;
}

// --- Durable mission persistence port -------------------------------------
//
// Adapters and Inngest functions never write mission state directly. Every
// committed side effect (events, approvals, idempotency reservations, usage
// debits) is routed through this port so the harness stays swappable between
// a live Supabase-backed repository and an in-memory test double.

export type IdempotencyState =
  | "new"
  | "reserved"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "conflict";

export type ReserveIdempotencyInput = {
  tenantId: string;
  missionId: string;
  nodeId?: string;
  capabilityId: string;
  action: string;
  key: string;
  requestFingerprint: string;
};

export type IdempotencyReservation = {
  state: IdempotencyState;
  storedResult?: JsonValue;
};

export type CompleteIdempotencyInput = {
  tenantId: string;
  key: string;
  outcome: "succeeded" | "failed_retryable" | "failed_terminal";
  result?: JsonValue;
};

export type RecordUsageInput = {
  tenantId: string;
  missionId: string;
  nodeId?: string;
  subjectKind: "mission" | "node";
  subjectId: string;
  metric: string;
  quantity: number;
  costMicrounits: number;
  limitQuantity: number;
  limitCostMicrounits: number;
  windowStart: string;
  windowEnd: string;
  idempotencyKey: string;
  correlationId: string;
};

export type RecordUsageResult = {
  totalQuantity: number;
  totalCostMicrounits: number;
};

/**
 * The only path through which harness code may commit durable mission
 * state. `appendEvent` and `requestApproval` reuse the exact BE-01 repository
 * command/result shapes so a live implementation is a thin adapter, not a
 * translation layer. `reserveIdempotency` / `completeIdempotency` describe
 * the contract the harness needs; a live binding lands once the parallel
 * repository work adds the matching RPCs (see RepositoryPersistence TODOs).
 */
export interface HarnessPersistencePort {
  appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent>;
  requestApproval(command: RequestApprovalCommand): Promise<MissionApproval>;
  reserveIdempotency(input: ReserveIdempotencyInput): Promise<IdempotencyReservation>;
  completeIdempotency(input: CompleteIdempotencyInput): Promise<void>;
  recordUsage(input: RecordUsageInput): Promise<RecordUsageResult>;
}
