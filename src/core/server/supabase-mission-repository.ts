import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  JsonValue,
  Mandate,
  Mission,
  MissionApproval,
  MissionCheckpoint,
  MissionEdge,
  MissionEvent,
  MissionNode,
  MissionSnapshot,
  SecurityEvent,
  UsageEntry,
} from "../contracts/types";
import type {
  Database,
  Json,
  MissionApprovalRow,
  MissionCheckpointRow,
  MissionEdgeRow,
  MissionEventRow,
  MissionMandateRow,
  MissionNodeRow,
  MissionRow,
  UsageLedgerRow,
} from "../database.types";
import type {
  AppendMissionEventCommand,
  ConsumeUsageCommand,
  CreateMissionCommand,
  MissionRepository,
  RequestApprovalCommand,
  ResolveApprovalCommand,
} from "../repositories/mission-repository";
import { RedactedDatabaseError } from "./database";

function fail(error: { code?: string } | null): never {
  throw new RedactedDatabaseError(error?.code);
}

function one<T>(data: T | T[] | null): T {
  if (data === null) fail(null);
  return Array.isArray(data) ? (data[0] ?? fail(null)) : data;
}

function mapMission(row: MissionRow): Mission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    status: row.status,
    mandateVersion: row.mandate_version,
    rootNodeId: row.root_node_id,
    lastEventSequence: row.last_event_sequence,
    stateVersion: row.state_version,
    budgetLimits: row.budget_limits as Mission["budgetLimits"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMandate(row: MissionMandateRow): Mandate {
  return {
    missionId: row.mission_id,
    version: row.version,
    goal: row.goal,
    constraints: row.constraints as JsonValue[],
    authority: row.authority as Mandate["authority"],
    selectedContextCardIds: row.selected_context_card_ids,
    createdBy: {
      kind: row.created_by_kind as Mandate["createdBy"]["kind"],
      id: row.created_by_id,
    },
    createdAt: row.created_at,
  };
}

function mapNode(row: MissionNodeRow): MissionNode {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    parentId: row.parent_id,
    codename: row.codename,
    roleLabel: row.role_label,
    objective: row.objective,
    status: row.status as MissionNode["status"],
    requiredCapabilities: row.required_capabilities as MissionNode["requiredCapabilities"],
    inputRefs: row.input_refs as string[],
    outputRefs: row.output_refs as string[],
    budgetLimits: row.budget_limits as MissionNode["budgetLimits"],
    version: row.version,
  };
}

function mapEdge(row: MissionEdgeRow): MissionEdge {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    kind: row.kind as MissionEdge["kind"],
    condition: (row.condition ?? undefined) as JsonValue | undefined,
  };
}

function mapEvent(row: MissionEventRow): MissionEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    nodeId: row.node_id ?? undefined,
    sequence: row.sequence,
    type: row.event_type as MissionEvent["type"],
    actor: { kind: row.actor_kind as MissionEvent["actor"]["kind"], id: row.actor_id },
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    payload: row.payload as JsonValue,
    trust: row.trust as MissionEvent["trust"],
    createdAt: row.created_at,
  };
}

function mapApproval(row: MissionApprovalRow): MissionApproval {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    status: row.status as MissionApproval["status"],
    category: row.category,
    actionFingerprint: row.action_fingerprint,
    recommendation: row.recommendation,
    alternatives: row.alternatives as JsonValue[],
    evidence: row.evidence as JsonValue[],
    consequence: row.consequence,
    mandateVersion: row.mandate_version,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution as JsonValue | null,
  };
}

function mapCheckpoint(row: MissionCheckpointRow): MissionCheckpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    sequence: row.sequence,
    label: row.label,
    snapshot: row.snapshot as MissionCheckpoint["snapshot"],
    digest: row.digest,
    createdAt: row.created_at,
  };
}

function mapUsage(row: UsageLedgerRow): UsageEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    subjectKind: row.subject_kind as UsageEntry["subjectKind"],
    subjectId: row.subject_id,
    metric: row.metric,
    quantity: row.quantity,
    costMicrounits: row.cost_microunits,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
  };
}

export class SupabaseMissionRepository implements MissionRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getMission(identifier: string): Promise<MissionSnapshot | null> {
    const missionResult = await this.client
      .from("missions")
      .select("*")
      .eq("id", identifier)
      .maybeSingle();
    if (missionResult.error) fail(missionResult.error);
    if (!missionResult.data) return null;

    const [mandateResult, nodesResult, edgesResult, approvalsResult] = await Promise.all([
      this.client
        .from("mission_mandates")
        .select("*")
        .eq("mission_id", identifier)
        .eq("version", missionResult.data.mandate_version)
        .maybeSingle(),
      this.client.from("mission_nodes").select("*").eq("mission_id", identifier),
      this.client.from("mission_edges").select("*").eq("mission_id", identifier),
      this.client
        .from("mission_approvals")
        .select("*")
        .eq("mission_id", identifier)
        .eq("status", "pending"),
    ]);
    if (mandateResult.error) fail(mandateResult.error);
    if (nodesResult.error) fail(nodesResult.error);
    if (edgesResult.error) fail(edgesResult.error);
    if (approvalsResult.error) fail(approvalsResult.error);
    if (!mandateResult.data) fail(null);

    return {
      mission: mapMission(missionResult.data),
      mandate: mapMandate(mandateResult.data),
      nodes: nodesResult.data.map(mapNode),
      edges: edgesResult.data.map(mapEdge),
      pendingApprovals: approvalsResult.data.map(mapApproval),
      latestSequence: missionResult.data.last_event_sequence,
    };
  }

  async listEvents(missionId: string, afterSequence = 0): Promise<MissionEvent[]> {
    const result = await this.client
      .from("mission_events")
      .select("*")
      .eq("mission_id", missionId)
      .gt("sequence", afterSequence)
      .order("sequence", { ascending: true })
      .limit(500);
    if (result.error) fail(result.error);
    return result.data.map(mapEvent);
  }

  async createMission(command: CreateMissionCommand): Promise<MissionSnapshot> {
    const result = await this.client.rpc("create_mission", {
      p_tenant_id: command.tenantId,
      p_title: command.title,
      p_goal: command.goal,
      p_constraints: command.constraints as Json,
      p_authority: command.authority as Json,
      p_selected_context_card_ids: command.selectedContextCardIds,
      p_budget_limits: command.budgetLimits as Json,
      p_actor_kind: command.actor.kind,
      p_actor_id: command.actor.id,
      p_correlation_id: command.correlationId,
    });
    if (result.error) fail(result.error);
    const created = one(result.data);
    const snapshot = await this.getMission(created.id);
    return snapshot ?? fail(null);
  }

  async appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    const result = await this.client.rpc("append_mission_event", {
      p_mission_id: command.missionId,
      p_expected_sequence: command.expectedSequence,
      p_event_type: command.type,
      p_actor_kind: command.actor.kind,
      p_actor_id: command.actor.id,
      p_correlation_id: command.correlationId,
      p_payload: command.payload as Json,
      p_trust: command.trust,
      p_causation_id: command.causationId ?? null,
      p_idempotency_key: command.idempotencyKey ?? null,
      p_mission_status: command.materialization?.missionStatus ?? null,
      p_node_id: command.nodeId ?? command.materialization?.nodeId ?? null,
      p_node_status: command.materialization?.nodeStatus ?? null,
    });
    if (result.error) fail(result.error);
    return mapEvent(one(result.data));
  }

  async requestApproval(command: RequestApprovalCommand): Promise<MissionApproval> {
    const result = await this.client.rpc("request_mission_approval", {
      p_mission_id: command.missionId,
      p_node_id: command.nodeId ?? null,
      p_expected_sequence: command.expectedSequence,
      p_category: command.category,
      p_action_fingerprint: command.actionFingerprint,
      p_recommendation: command.recommendation,
      p_alternatives: command.alternatives as Json,
      p_evidence: command.evidence as Json,
      p_consequence: command.consequence,
      p_mandate_version: command.mandateVersion,
      p_expires_at: command.expiresAt ?? null,
      p_actor_kind: command.actor.kind,
      p_actor_id: command.actor.id,
      p_correlation_id: command.correlationId,
      p_idempotency_key: command.idempotencyKey,
    });
    if (result.error) fail(result.error);
    return mapApproval(one(result.data));
  }

  async resolveApproval(command: ResolveApprovalCommand): Promise<MissionApproval> {
    const result = await this.client.rpc("resolve_mission_approval", {
      p_approval_id: command.approvalId,
      p_decision: command.decision,
      p_resolution: command.resolution as Json,
      p_actor_kind: command.actor.kind,
      p_actor_id: command.actor.id,
      p_correlation_id: command.correlationId,
      p_idempotency_key: command.idempotencyKey,
    });
    if (result.error) fail(result.error);
    return mapApproval(one(result.data));
  }

  async createCheckpoint(input: Parameters<MissionRepository["createCheckpoint"]>[0]) {
    const result = await this.client.rpc("create_mission_checkpoint", {
      p_mission_id: input.missionId,
      p_node_id: input.nodeId ?? null,
      p_expected_sequence: input.expectedSequence,
      p_label: input.label,
      p_snapshot: input.snapshot as Json,
      p_digest: input.digest,
      p_actor_kind: input.actor.kind,
      p_actor_id: input.actor.id,
      p_correlation_id: input.correlationId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (result.error) fail(result.error);
    return mapCheckpoint(one(result.data));
  }

  async revertToCheckpoint(input: Parameters<MissionRepository["revertToCheckpoint"]>[0]) {
    const result = await this.client.rpc("revert_mission_to_checkpoint", {
      p_mission_id: input.missionId,
      p_checkpoint_id: input.checkpointId,
      p_expected_sequence: input.expectedSequence,
      p_actor_kind: input.actor.kind,
      p_actor_id: input.actor.id,
      p_correlation_id: input.correlationId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (result.error) fail(result.error);
    return mapEvent(one(result.data));
  }

  async consumeUsage(command: ConsumeUsageCommand) {
    const result = await this.client.rpc("consume_usage", {
      p_tenant_id: command.tenantId,
      p_mission_id: command.missionId ?? null,
      p_node_id: command.nodeId ?? null,
      p_subject_kind: command.subjectKind,
      p_subject_id: command.subjectId,
      p_metric: command.metric,
      p_quantity: command.quantity,
      p_cost_microunits: command.costMicrounits,
      p_limit_quantity: command.limitQuantity,
      p_limit_cost_microunits: command.limitCostMicrounits,
      p_window_start: command.windowStart,
      p_window_end: command.windowEnd,
      p_idempotency_key: command.idempotencyKey,
      p_correlation_id: command.correlationId,
    });
    if (result.error) fail(result.error);
    const payload = one(result.data as Json | Json[] | null) as Record<string, Json>;
    return {
      entry: mapUsage(payload.entry as unknown as UsageLedgerRow),
      totalQuantity: Number(payload.totalQuantity),
      totalCostMicrounits: Number(payload.totalCostMicrounits),
    };
  }

  async recordSecurityEvent(event: Omit<SecurityEvent, "id" | "createdAt">) {
    const result = await this.client.rpc("record_security_event", {
      p_tenant_id: event.tenantId,
      p_mission_id: event.missionId ?? null,
      p_event_type: event.type,
      p_severity: event.severity,
      p_actor_kind: event.actor.kind,
      p_actor_id: event.actor.id,
      p_ip_signal_hash: null,
      p_origin: event.origin ?? null,
      p_redacted_payload: event.redactedPayload as Json,
      p_correlation_id: event.correlationId,
    });
    if (result.error) fail(result.error);
  }
}
