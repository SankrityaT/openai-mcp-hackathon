import type { JsonValue, MissionApproval, MissionEvent, MissionStatus, NodeStatus } from "@/core/contracts/types";
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
import { QUOTA_DATABASE_ERROR_CODE } from "../../core/contracts/quota-errors";

/**
 * Stand-in for the `RedactedDatabaseError` the live repository raises when
 * `consume_usage` reports `P0001`. Only the code carries meaning; callers
 * classify it with `isQuotaDatabaseErrorCode`, never by message.
 */
export class QuotaDatabaseError extends Error {
  readonly code = QUOTA_DATABASE_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = "QuotaDatabaseError";
  }
}

/**
 * Stand-in for the `RedactedDatabaseError` the live repository raises for the
 * deterministic conflicts the RPCs define, both from
 * supabase/migrations/20260826010000_deterministic_conflict_codes.sql: `23505`
 * when an idempotency key is reused with a different event type or payload,
 * and `55000` when `complete_idempotency` is asked to update a missing or
 * terminal row. The latter was raised as `40001` by the superseded
 * 20260826000200_transactions_and_guards.sql; a serialization-failure code
 * invites a blind retry, which is exactly wrong for a deterministic
 * business-rule refusal. Only the code carries meaning; the live message is
 * redacted.
 */
export class ConflictDatabaseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ConflictDatabaseError";
  }
}

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
  /** Every usage call the run attempted, in order, including refused ones. */
  readonly usageRecords: RecordUsageInput[] = [];
  /**
   * The materialized `mission_nodes.status` / `missions.status` columns, keyed
   * by node and mission id. Modeled because `append_mission_event` runs its
   * `p_node_status` / `p_mission_status` block ONLY when it actually commits:
   * a key that short-circuits into a replay returns the existing event without
   * materializing anything. A test that only inspects the event log cannot see
   * a board left stuck on a stale status; these maps can.
   */
  readonly nodeStatuses = new Map<string, NodeStatus>();
  readonly missionStatuses = new Map<string, MissionStatus>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly usage = new Map<string, { quantity: number; cost: number }>();
  private readonly usageByKey = new Map<string, RecordUsageResult>();
  private readonly sequenceCursor = new Map<string, number>();

  async listEvents(missionId: string): Promise<MissionEvent[]> {
    return this.events.filter((event) => event.missionId === missionId);
  }

  async appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    const current = this.sequenceCursor.get(command.missionId) ?? 0;
    // Mirrors append_mission_event's key-based dedup, checked BEFORE the
    // sequence token exactly as the RPC orders it: a known key with the
    // identical event type and payload replays the committed event, and any
    // other reuse is the deterministic 23505 conflict. Payload equality is
    // structural via JSON text, which matches because both appends of a
    // replayed event are built by the same code path.
    if (command.idempotencyKey) {
      const stored = this.events.find(
        (event) =>
          event.missionId === command.missionId && event.idempotencyKey === command.idempotencyKey,
      );
      if (stored) {
        if (
          stored.type !== command.type ||
          JSON.stringify(stored.payload) !== JSON.stringify(command.payload)
        ) {
          throw new ConflictDatabaseError("23505", "Idempotency key conflict");
        }
        // Deliberately returns BEFORE the materialization below: the RPC's
        // status block sits after its short-circuit, so a replayed key never
        // moves the board.
        return stored;
      }
    }
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
    if (command.materialization?.nodeStatus && command.nodeId) {
      this.nodeStatuses.set(command.nodeId, command.materialization.nodeStatus);
    }
    if (command.materialization?.missionStatus) {
      this.missionStatuses.set(command.missionId, command.materialization.missionStatus);
    }
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
    // Mirrors complete_idempotency: only reserved/running/failed_retryable
    // rows may be completed, and a missing or terminal row raises 55000.
    if (!existing || existing.state === "succeeded" || existing.state === "failed_terminal") {
      throw new ConflictDatabaseError("55000", "Idempotency record is missing or terminal");
    }
    existing.state = input.outcome;
    existing.result = input.result;
  }

  /**
   * Mirrors the `consume_usage` RPC rather than merely counting: it replays an
   * already-applied idempotency key with the totals it produced, and refuses
   * to commit past either ceiling by raising the same `P0001` code the
   * database raises. Tests that gate on a budget therefore exercise the real
   * refusal path instead of a hollow stub.
   */
  async recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    this.usageRecords.push(input);
    const replay = this.usageByKey.get(input.idempotencyKey);
    if (replay) return { ...replay };

    const key = `${input.subjectKind}:${input.subjectId}:${input.metric}`;
    const current = this.usage.get(key) ?? { quantity: 0, cost: 0 };
    const nextQuantity = current.quantity + input.quantity;
    const nextCost = current.cost + input.costMicrounits;
    if (nextQuantity > input.limitQuantity) {
      throw new QuotaDatabaseError("Quota exhausted");
    }
    if (nextCost > input.limitCostMicrounits) {
      throw new QuotaDatabaseError("Cost budget exhausted");
    }
    this.usage.set(key, { quantity: nextQuantity, cost: nextCost });
    const result: RecordUsageResult = { totalQuantity: nextQuantity, totalCostMicrounits: nextCost };
    this.usageByKey.set(input.idempotencyKey, result);
    return { ...result };
  }
}
