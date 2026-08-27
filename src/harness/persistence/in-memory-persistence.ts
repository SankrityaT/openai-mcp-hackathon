import type { JsonValue, MissionApproval, MissionEvent } from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import type {
  CompleteIdempotencyInput,
  HarnessPersistencePort,
  IdempotencyReservation,
  IdempotencyState,
  RecordUsageInput,
  RecordUsageResult,
  ReserveIdempotencyInput,
} from "../contracts";

type IdempotencyRecord = {
  state: IdempotencyState;
  requestFingerprint: string;
  result?: JsonValue;
};

/**
 * Dependency-free in-memory implementation of `HarnessPersistencePort` for
 * unit tests. Enforces the same optimistic-sequence and idempotency-state
 * semantics as the live repository/policy engine so tests exercise real
 * behavior, not a hollow mock.
 */
export class InMemoryPersistence implements HarnessPersistencePort {
  readonly events: MissionEvent[] = [];
  readonly approvals: MissionApproval[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly usage = new Map<string, { quantity: number; cost: number }>();
  private readonly sequenceCursor = new Map<string, number>();

  async appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    const current = this.sequenceCursor.get(command.missionId) ?? 0;
    // Mirrors append_mission_event: `expectedSequence` is the CURRENT last
    // sequence (the optimistic-concurrency token), and the appended event
    // receives `current + 1`.
    if (command.expectedSequence !== current) {
      throw new Error(
        `stale sequence for mission ${command.missionId}: expected ${current}, got ${command.expectedSequence}`,
      );
    }
    const event: MissionEvent = {
      id: `evt_${command.missionId}_${current + 1}`,
      tenantId: "in-memory-tenant",
      missionId: command.missionId,
      nodeId: command.nodeId,
      sequence: current + 1,
      type: command.type,
      actor: command.actor,
      correlationId: command.correlationId,
      causationId: command.causationId,
      idempotencyKey: command.idempotencyKey,
      payload: command.payload,
      trust: command.trust,
      createdAt: new Date().toISOString(),
    };
    this.sequenceCursor.set(command.missionId, event.sequence);
    this.events.push(event);
    return event;
  }

  async requestApproval(command: RequestApprovalCommand): Promise<MissionApproval> {
    const approvalEvent = await this.appendEvent({
      missionId: command.missionId,
      nodeId: command.nodeId,
      expectedSequence: command.expectedSequence,
      type: "approval.requested",
      actor: command.actor,
      correlationId: command.correlationId,
      idempotencyKey: command.idempotencyKey,
      payload: {
        category: command.category,
        actionFingerprint: command.actionFingerprint,
        recommendation: command.recommendation,
        consequence: command.consequence,
      },
      trust: "derived",
    });
    const approval: MissionApproval = {
      id: `apr_${approvalEvent.id}`,
      tenantId: "in-memory-tenant",
      missionId: command.missionId,
      nodeId: command.nodeId ?? null,
      status: "pending",
      category: command.category,
      actionFingerprint: command.actionFingerprint,
      recommendation: command.recommendation,
      alternatives: command.alternatives,
      evidence: command.evidence,
      consequence: command.consequence,
      mandateVersion: command.mandateVersion,
      expiresAt: command.expiresAt ?? null,
      resolvedAt: null,
      resolution: null,
    };
    this.approvals.push(approval);
    return approval;
  }

  async reserveIdempotency(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
    const existing = this.idempotency.get(input.key);
    if (!existing) {
      this.idempotency.set(input.key, { state: "reserved", requestFingerprint: input.requestFingerprint });
      return { state: "new" };
    }
    if (existing.requestFingerprint !== input.requestFingerprint) {
      return { state: "conflict" };
    }
    return { state: existing.state, storedResult: existing.result };
  }

  async completeIdempotency(input: CompleteIdempotencyInput): Promise<void> {
    const existing = this.idempotency.get(input.key);
    if (!existing) return;
    existing.state = input.outcome;
    existing.result = input.result;
  }

  async recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    const key = `${input.subjectKind}:${input.subjectId}:${input.metric}`;
    const current = this.usage.get(key) ?? { quantity: 0, cost: 0 };
    current.quantity += input.quantity;
    current.cost += input.costMicrounits;
    this.usage.set(key, current);
    return { totalQuantity: current.quantity, totalCostMicrounits: current.cost };
  }
}
