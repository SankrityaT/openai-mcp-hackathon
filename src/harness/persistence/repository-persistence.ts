import "server-only";

import { createHash } from "node:crypto";
import type { MissionApproval, MissionEvent } from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  IdempotencyReservation as StoredIdempotencyReservation,
  MissionRepository,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import type {
  CompleteIdempotencyInput,
  HarnessPersistencePort,
  IdempotencyReservation,
  RecordUsageInput,
  RecordUsageResult,
  ReserveIdempotencyInput,
} from "../contracts";

/**
 * Adapts the landed BE-01 `MissionRepository` to the harness persistence
 * port. All bindings are live, including `reserveIdempotency` /
 * `completeIdempotency` over the `reserve_idempotency` /
 * `complete_idempotency` RPCs (service-role only — construct this class with
 * the admin repository in durable jobs).
 */
const MAX_SEQUENCE_RETRY_ATTEMPTS = 10;

/**
 * One shared scope for harness-side reservations: the (tenant, scope, key)
 * uniqueness constraint does the real work because `buildIdempotencyKey`
 * already encodes mission, node, capability, action, mandate version, and
 * request fingerprint into the key. A constant scope also lets
 * `completeIdempotency` rebuild the reservation identity from the key alone.
 */
const IDEMPOTENCY_SCOPE = "harness";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `reserve_idempotency` validates `p_request_fingerprint` against
 * `^[a-f0-9]{64}$`. Harness keys look like `idem_<sha256hex>`, so reuse the
 * embedded digest when present and hash anything else.
 */
function fingerprintForKey(key: string): string {
  const embedded = /^idem_([a-f0-9]{64})$/.exec(key);
  if (embedded) return embedded[1];
  return createHash("sha256").update(key).digest("hex");
}

function mapStoredReservation(
  record: StoredIdempotencyReservation,
  sentExpiresAt: string,
): IdempotencyReservation {
  switch (record.status) {
    case "succeeded":
      return { state: "succeeded", storedResult: record.responseRef ?? undefined };
    case "failed_retryable":
      return { state: "failed_retryable" };
    case "failed_terminal":
    case "cancelled":
      return { state: "failed_terminal" };
    case "reserved":
    case "running": {
      // The RPC upserts and returns the row either way, so "did this call
      // create the reservation" is inferred from the expiry we sent: a
      // pre-existing in-flight reservation keeps its creator's earlier
      // expiry. Millisecond-identical duplicate creation is the residual
      // race; an `inserted` flag on the RPC would close it (BE-08 note).
      const createdByThisCall =
        Date.parse(record.expiresAt) === Date.parse(sentExpiresAt);
      return { state: createdByThisCall ? "new" : "reserved" };
    }
  }
}

export class RepositoryPersistence implements HarnessPersistencePort {
  constructor(private readonly repository: MissionRepository) {}

  async listEvents(missionId: string) {
    return this.repository.listEvents(missionId);
  }

  /**
   * Up to five independent node workers may append events to the same
   * mission concurrently (ARCHITECTURE.md "Independent nodes execute
   * durably in parallel"), but `append_mission_event` is single-writer per
   * mission and rejects a caller whose `expectedSequence` is stale. Rather
   * than guess at the RPC's redacted Postgres error code
   * (`RedactedDatabaseError` intentionally strips the message), this
   * re-reads the mission after any failure: if the freshly observed next
   * sequence differs from what was attempted, the failure was very likely
   * sequence contention from a concurrent writer, so it retries once with
   * the corrected value. If the observed next sequence matches what was
   * already attempted, the failure was not a sequence conflict and the
   * original error is rethrown unchanged.
   */
  private async withSequenceRetry<TCommand extends { missionId: string; expectedSequence: number }, TResult>(
    command: TCommand,
    run: (command: TCommand) => Promise<TResult>,
  ): Promise<TResult> {
    let attempted = command;
    for (let attempt = 1; attempt <= MAX_SEQUENCE_RETRY_ATTEMPTS; attempt++) {
      try {
        return await run(attempted);
      } catch (error) {
        if (attempt === MAX_SEQUENCE_RETRY_ATTEMPTS) throw error;
        const snapshot = await this.repository.getMission(command.missionId);
        const observedLast = snapshot ? snapshot.latestSequence : undefined;
        if (observedLast === undefined || observedLast === attempted.expectedSequence) {
          throw error;
        }
        attempted = { ...attempted, expectedSequence: observedLast };
      }
    }
    throw new Error("unreachable: sequence retry loop exhausted without resolution");
  }

  appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    return this.withSequenceRetry(command, (attempted) => this.repository.appendEvent(attempted));
  }

  requestApproval(command: RequestApprovalCommand): Promise<MissionApproval> {
    return this.withSequenceRetry(command, (attempted) => this.repository.requestApproval(attempted));
  }

  async reserveIdempotency(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
    const record = await this.repository.reserveIdempotency({
      tenantId: input.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey: input.key,
      requestFingerprint: fingerprintForKey(input.key),
      expiresAt,
    });
    return mapStoredReservation(record, expiresAt);
  }

  async completeIdempotency(input: CompleteIdempotencyInput): Promise<void> {
    await this.repository.completeIdempotency({
      tenantId: input.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey: input.key,
      requestFingerprint: fingerprintForKey(input.key),
      status: input.outcome,
      responseRef: input.result,
    });
  }

  async recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    const { totalQuantity, totalCostMicrounits } = await this.repository.consumeUsage({
      tenantId: input.tenantId,
      missionId: input.missionId,
      nodeId: input.nodeId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      metric: input.metric,
      quantity: input.quantity,
      costMicrounits: input.costMicrounits,
      limitQuantity: input.limitQuantity,
      limitCostMicrounits: input.limitCostMicrounits,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return { totalQuantity, totalCostMicrounits };
  }
}
