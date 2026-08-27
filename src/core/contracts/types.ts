export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type TenantScope = "user" | "guest" | "judge" | "public_fixture" | "system";

export type Tenant = {
  id: string;
  ownerUserId: string | null;
  scope: TenantScope;
  displayName: string;
  createdAt: string;
};

export type MissionStatus =
  | "draft"
  | "planning"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeStatus =
  | "planned"
  | "running"
  | "paused"
  | "waiting"
  | "needs_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalStatus =
  | "pending"
  | "resolved"
  | "rejected"
  | "expired"
  | "cancelled";

export type TrustLevel = "trusted" | "untrusted" | "derived";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Actor = {
  kind: "user" | "cardea" | "tool" | "system";
  id: string;
};

export type BudgetLimits = {
  maxModelCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxToolCalls?: number;
  maxRetries?: number;
  maxConcurrentWorkers?: number;
  maxWallClockMs?: number;
  maxCostMicrounits?: number;
  maxUntrustedBytes?: number;
};

export type QuotaSnapshot = {
  exhausted: boolean;
  metric?: string;
  used?: number;
  limit?: number;
};

export type BudgetSnapshot = {
  exhausted: boolean;
  estimatedCostMicrounits: number;
  spentCostMicrounits: number;
  limitCostMicrounits: number;
};

export type AuthorityPolicy = {
  freePassage: boolean;
  allowedCapabilityIds: string[];
  allowedOrigins: string[];
  allowedTargets: string[];
  allowedRiskLevels: RiskLevel[];
  maxAutonomousCostMicrounits: number;
  allowExternalSideEffects: boolean;
  requireApprovalCategories: ActionCategory[];
  /**
   * Capabilities the user has admitted to the mandate *only* behind the
   * approval hinge. Enumerating an id here does two things in the policy
   * engine, and nothing else: it lets the capability past the mandate's risk
   * ceiling (up to medium risk), and it forces every attempt onto
   * `require_approval` unless an exact current approval already covers the
   * action. Free Passage cannot shortcut it. Optional so that an authority
   * written before this field existed keeps its exact previous meaning.
   */
  approvalGatedCapabilityIds?: string[];
};

export type ActionCategory =
  | "read"
  | "external_write"
  | "payment_or_purchase"
  | "legal_agreement_or_signature"
  | "account_credential_or_permission_change"
  | "sensitive_outbound_message"
  | "destructive_deletion"
  | "protected_personal_data_disclosure";

export type Mandate = {
  missionId: string;
  version: number;
  goal: string;
  constraints: JsonValue[];
  authority: AuthorityPolicy;
  selectedContextCardIds: string[];
  createdBy: Actor;
  createdAt: string;
  approvedAt?: string | null;
};

export type Mission = {
  id: string;
  tenantId: string;
  title: string;
  status: MissionStatus;
  mandateVersion: number;
  rootNodeId: string | null;
  lastEventSequence: number;
  stateVersion: number;
  budgetLimits: BudgetLimits;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityRequirement = {
  name: string;
  optional?: boolean;
  constraints?: JsonValue;
};

export type MissionNode = {
  id: string;
  tenantId: string;
  missionId: string;
  parentId: string | null;
  codename: string;
  roleLabel: string;
  objective: string;
  status: NodeStatus;
  requiredCapabilities: CapabilityRequirement[];
  inputRefs: string[];
  outputRefs: string[];
  budgetLimits: BudgetLimits;
  version: number;
};

export type MissionEdge = {
  id: string;
  tenantId: string;
  missionId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "depends_on" | "blocks" | "informs" | "approves";
  condition?: JsonValue;
};

export type MissionEventType =
  | "mission.created"
  | "mission.completed"
  | "mission.failed"
  | "mission.cancelled"
  | "mission.reverted"
  | "mandate.proposed"
  | "mandate.revised"
  | "mandate.approved"
  | "node.planned"
  | "node.started"
  | "node.paused"
  | "node.resumed"
  | "node.redirected"
  | "node.completed"
  | "node.failed"
  | "node.reverted"
  | "capability.discovered"
  | "tool.requested"
  | "tool.approved"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "evidence.recorded"
  | "memory.proposed"
  | "memory.promoted"
  | "memory.edited"
  | "memory.forgotten"
  | "approval.requested"
  | "approval.resolved"
  | "approval.expired"
  | "dependency.added"
  | "dependency.removed"
  | "dependency.rerouted"
  | "checkpoint.created"
  | "quota.consumed"
  | "policy.denied"
  | "security.recorded";

export type MissionEvent<TPayload extends JsonValue = JsonValue> = {
  id: string;
  tenantId: string;
  missionId: string;
  nodeId?: string;
  sequence: number;
  type: MissionEventType;
  actor: Actor;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: TPayload;
  trust: TrustLevel;
  createdAt: string;
};

export type MissionApproval = {
  id: string;
  tenantId: string;
  missionId: string;
  nodeId: string | null;
  status: ApprovalStatus;
  category: ActionCategory | string;
  actionFingerprint: string;
  recommendation: string;
  alternatives: JsonValue[];
  evidence: JsonValue[];
  consequence: string;
  mandateVersion: number;
  expiresAt: string | null;
  resolvedAt: string | null;
  resolution: JsonValue | null;
};

export type MissionCheckpoint = {
  id: string;
  tenantId: string;
  missionId: string;
  nodeId: string | null;
  sequence: number;
  label: string;
  snapshot: MissionMaterializedState;
  digest: string;
  createdAt: string;
};

export type CapabilitySource = {
  id: string;
  tenantId: string;
  provider: string;
  externalRef: string;
  name: string;
  description: string;
  inputSchema: JsonValue;
  outputSchema?: JsonValue;
  risk: { level: RiskLevel; categories: ActionCategory[] };
  trust: { level: TrustLevel; verifiedAt?: string; provenance?: string };
  allowedOrigins: string[];
  enabled: boolean;
};

export type ContextCard = {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  connectorRefs: string[];
  memoryScopes: string[];
  authorityOverrides?: Partial<AuthorityPolicy>;
  visualTheme: string;
  version: number;
};

export type MemoryReference = {
  id: string;
  tenantId: string;
  missionId?: string;
  nodeId?: string;
  contextCardId?: string;
  provider: string;
  externalRef: string;
  version: number;
  source: JsonValue;
  influence: string;
  status: "proposed" | "promoted" | "forgotten" | "deleted";
};

export type ToolRun = {
  id: string;
  tenantId: string;
  missionId: string;
  nodeId?: string;
  capabilitySourceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  action: string;
  origin: string;
  target: JsonValue;
  status: "reserved" | "running" | "succeeded" | "failed" | "cancelled";
  requestSummary: JsonValue;
  resultSummary?: JsonValue;
  errorSummary?: JsonValue;
  attempt: number;
};

export type UsageEntry = {
  id: string;
  tenantId: string;
  missionId?: string;
  nodeId?: string;
  subjectKind: "user" | "guest" | "judge" | "mission" | "node" | "provider";
  subjectId: string;
  metric: string;
  quantity: number;
  costMicrounits: number;
  idempotencyKey: string;
  occurredAt: string;
};

export type SecurityEvent = {
  id: string;
  tenantId: string;
  missionId?: string;
  type: string;
  severity: "info" | "warning" | "high" | "critical";
  actor: Actor;
  origin?: string;
  redactedPayload: JsonValue;
  correlationId: string;
  createdAt: string;
};

export type MissionMaterializedState = {
  mission: Mission;
  nodes: Record<string, MissionNode>;
  edges: Record<string, MissionEdge>;
  approvals: Record<string, MissionApproval>;
  checkpointId: string | null;
};

export type MissionSnapshot = {
  mission: Mission;
  mandate: Mandate;
  nodes: MissionNode[];
  edges: MissionEdge[];
  pendingApprovals: MissionApproval[];
  latestSequence: number;
};
