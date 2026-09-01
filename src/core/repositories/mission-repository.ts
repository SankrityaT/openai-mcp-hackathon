import type {
  Actor,
  JsonValue,
  MissionApproval,
  MissionCheckpoint,
  MissionEvent,
  MissionEventType,
  MissionSnapshot,
  MissionStatus,
  NodeStatus,
  SecurityEvent,
  Tenant,
  UsageEntry,
} from "../contracts/types";

export interface MissionReadRepository<TMission = MissionSnapshot, TIdentifier = string> {
  getMission(identifier: TIdentifier): Promise<TMission | null>;
}

export type CreateMissionCommand = {
  tenantId: string;
  title: string;
  goal: string;
  constraints: JsonValue[];
  authority: JsonValue;
  selectedContextCardIds: string[];
  budgetLimits: JsonValue;
  actor: Actor;
  correlationId: string;
};

export type AppendMissionEventCommand = {
  missionId: string;
  nodeId?: string;
  expectedSequence: number;
  type: MissionEventType;
  actor: Actor;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: JsonValue;
  trust: "trusted" | "untrusted" | "derived";
  materialization?: {
    missionStatus?: MissionStatus;
    nodeId?: string;
    nodeStatus?: NodeStatus;
  };
};

export type RequestApprovalCommand = {
  missionId: string;
  nodeId?: string;
  expectedSequence: number;
  category: string;
  actionFingerprint: string;
  recommendation: string;
  alternatives: JsonValue[];
  evidence: JsonValue[];
  consequence: string;
  mandateVersion: number;
  expiresAt?: string;
  actor: Actor;
  correlationId: string;
  idempotencyKey: string;
};

export type ResolveApprovalCommand = {
  approvalId: string;
  decision: "accepted" | "modified" | "rejected";
  resolution: JsonValue;
  actor: Actor;
  correlationId: string;
  idempotencyKey: string;
};

export type ConsumeUsageCommand = {
  tenantId: string;
  missionId?: string;
  nodeId?: string;
  subjectKind: UsageEntry["subjectKind"];
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

export type IdempotencyStatus =
  | "reserved"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export type IdempotencyTerminalStatus = Exclude<IdempotencyStatus, "reserved" | "running">;

export type IdempotencyReservation = {
  id: string;
  tenantId: string;
  scope: string;
  idempotencyKey: string;
  requestFingerprint: string;
  status: IdempotencyStatus;
  responseRef: JsonValue | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ReserveIdempotencyCommand = {
  tenantId: string;
  scope: string;
  idempotencyKey: string;
  /** Lowercase SHA-256 hex digest of the canonical request. */
  requestFingerprint: string;
  expiresAt: string;
};

export type CompleteIdempotencyCommand = {
  tenantId: string;
  scope: string;
  idempotencyKey: string;
  requestFingerprint: string;
  status: IdempotencyTerminalStatus;
  responseRef?: JsonValue;
};

/** Result of a server-side allowance reservation. */
export type QuotaReservation = {
  tenantId: string;
  used: number;
  limit: number;
};

export type ReserveGuestMissionCommand = {
  /** SHA-256 hex digest of the guest session token. Raw tokens never reach the database. */
  sessionTokenHash: string;
  /** Hashed abuse signal only. Never an identity. */
  ipSignalHash?: string;
};

export type ReserveJudgeRunCommand = {
  /** SHA-256 hex digest of the judge code. Only hashes are stored. */
  codeHash: string;
};

/**
 * Server-only reservation surface. Every function behind it is granted to the
 * secret role alone, so these methods must never be reachable from a browser
 * session repository.
 */
export interface MissionReservationRepository {
  reserveIdempotency(command: ReserveIdempotencyCommand): Promise<IdempotencyReservation>;
  completeIdempotency(command: CompleteIdempotencyCommand): Promise<IdempotencyReservation>;
  reserveGuestMission(command: ReserveGuestMissionCommand): Promise<QuotaReservation>;
  reserveJudgeRun(command: ReserveJudgeRunCommand): Promise<QuotaReservation>;
}

export interface MissionEventRepository {
  listEvents(missionId: string, afterSequence?: number): Promise<MissionEvent[]>;
  appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent>;
}

export interface MissionApprovalRepository {
  requestApproval(command: RequestApprovalCommand): Promise<MissionApproval>;
  resolveApproval(command: ResolveApprovalCommand): Promise<MissionApproval>;
  /**
   * The mission an approval belongs to, or null when the approval does not
   * exist (or the caller's row-level scope cannot see it). Lets a route
   * verify an approval id actually belongs to the mission the caller was
   * authorized against before settling it.
   */
  getApprovalMissionId(approvalId: string): Promise<string | null>;
}

export interface MissionCheckpointRepository {
  createCheckpoint(input: {
    missionId: string;
    nodeId?: string;
    expectedSequence: number;
    label: string;
    snapshot: JsonValue;
    digest: string;
    actor: Actor;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<MissionCheckpoint>;
  revertToCheckpoint(input: {
    missionId: string;
    checkpointId: string;
    expectedSequence: number;
    actor: Actor;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<MissionEvent>;
}

export interface MissionAuditRepository {
  recordSecurityEvent(event: Omit<SecurityEvent, "id" | "createdAt">): Promise<void>;
  consumeUsage(command: ConsumeUsageCommand): Promise<{
    entry: UsageEntry;
    totalQuantity: number;
    totalCostMicrounits: number;
  }>;
}

export interface MissionRepository
  extends MissionReadRepository,
    MissionEventRepository,
    MissionApprovalRepository,
    MissionCheckpointRepository,
    MissionAuditRepository,
    MissionReservationRepository {
  ensureUserTenant(displayName?: string): Promise<Tenant>;
  createMission(command: CreateMissionCommand): Promise<MissionSnapshot>;
}
