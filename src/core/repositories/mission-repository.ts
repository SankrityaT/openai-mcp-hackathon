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

export interface MissionEventRepository {
  listEvents(missionId: string, afterSequence?: number): Promise<MissionEvent[]>;
  appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent>;
}

export interface MissionApprovalRepository {
  requestApproval(command: RequestApprovalCommand): Promise<MissionApproval>;
  resolveApproval(command: ResolveApprovalCommand): Promise<MissionApproval>;
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
    MissionAuditRepository {
  createMission(command: CreateMissionCommand): Promise<MissionSnapshot>;
}
