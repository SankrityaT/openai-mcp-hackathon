import type { BudgetLimits, JsonValue, RiskLevel, TrustLevel } from "@/core/contracts/types";

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
