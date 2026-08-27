import "server-only";

import type { MissionApproval, MissionEvent } from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
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
 * port. `appendEvent` and `requestApproval` are live bindings today.
 * `reserveIdempotency` / `completeIdempotency` are TODO pending the parallel
 * repository work that adds `reserve_idempotency` / `complete_idempotency`
 * RPC bindings to `MissionRepository` (see docs/CORE_DATA_POLICY.md, which
 * already documents those functions at the database layer but does not yet
 * expose them on the TypeScript repository interface this harness depends
 * on). Until that lands, every reservation reports "new" and completion is a
 * no-op: capability execution still runs the idempotency check and skip
 * logic so no code path needs to change once the binding appears, but the
 * harness cannot yet durably prevent a duplicate side effect across process
 * restarts through the live repository alone.
 */
const MAX_SEQUENCE_RETRY_ATTEMPTS = 10;

export class RepositoryPersistence implements HarnessPersistencePort {
  constructor(private readonly repository: MissionRepository) {}

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
        const observedNext = snapshot ? snapshot.latestSequence + 1 : undefined;
        if (observedNext === undefined || observedNext === attempted.expectedSequence) {
          throw error;
        }
        attempted = { ...attempted, expectedSequence: observedNext };
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

  // TODO(BE-01 parallel): bind to `repository.reserveIdempotency` once the
  // `reserve_idempotency` RPC is exposed on `MissionRepository`.
  async reserveIdempotency(_input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
    void _input;
    return { state: "new" };
  }

  // TODO(BE-01 parallel): bind to `repository.completeIdempotency` once the
  // `complete_idempotency` RPC is exposed on `MissionRepository`.
  async completeIdempotency(_input: CompleteIdempotencyInput): Promise<void> {
    void _input;
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
