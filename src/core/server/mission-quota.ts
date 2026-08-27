import "server-only";

import {
  buildQuotaDenial,
  isQuotaDatabaseErrorCode,
  QuotaDeniedError,
  type QuotaSubjectScope,
} from "../contracts/quota-errors";
import { DEFAULT_GUEST_MISSION_LIMIT, DEFAULT_JUDGE_RUN_LIMIT } from "../policy/quota";
import type { MissionRepository, QuotaReservation } from "../repositories/mission-repository";
import { RedactedDatabaseError } from "./database";

export const MISSION_CREATION_METRIC = "mission.created";

/** Missions an authenticated account may create per UTC day. */
export const USER_MISSION_CREATION_DAILY_LIMIT = 25;

/** Mission creation itself debits no provider cost; model spend is metered separately. */
const MISSION_CREATION_COST_MICROUNITS = 0;
const MISSION_CREATION_COST_CEILING_MICROUNITS = 0;

export function utcDayWindow(now: Date = new Date()): {
  windowStart: string;
  windowEnd: string;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

function denyOnQuotaError(
  error: unknown,
  scope: QuotaSubjectScope,
  limit: number | null,
): never {
  if (error instanceof RedactedDatabaseError && isQuotaDatabaseErrorCode(error.code)) {
    throw new QuotaDeniedError(
      buildQuotaDenial({ scope, metric: MISSION_CREATION_METRIC, limit }),
    );
  }
  throw error;
}

/**
 * Debits one mission creation from an authenticated account's daily allowance
 * before any mission row exists. The database serialises the window, so this is
 * the authoritative check; no client-side counter is trusted.
 */
export async function consumeUserMissionQuota(
  repository: MissionRepository,
  input: { tenantId: string; userId: string; correlationId: string },
): Promise<void> {
  const { windowStart, windowEnd } = utcDayWindow();
  try {
    await repository.consumeUsage({
      tenantId: input.tenantId,
      subjectKind: "user",
      subjectId: input.userId,
      metric: MISSION_CREATION_METRIC,
      quantity: 1,
      costMicrounits: MISSION_CREATION_COST_MICROUNITS,
      limitQuantity: USER_MISSION_CREATION_DAILY_LIMIT,
      limitCostMicrounits: MISSION_CREATION_COST_CEILING_MICROUNITS,
      windowStart,
      windowEnd,
      idempotencyKey: `mission-create:${input.correlationId}`,
      correlationId: input.correlationId,
    });
  } catch (error) {
    denyOnQuotaError(error, "user", USER_MISSION_CREATION_DAILY_LIMIT);
  }
}

export async function reserveGuestMissionQuota(
  repository: MissionRepository,
  input: { sessionTokenHash: string; ipSignalHash?: string },
): Promise<QuotaReservation> {
  try {
    return await repository.reserveGuestMission(input);
  } catch (error) {
    denyOnQuotaError(error, "guest", DEFAULT_GUEST_MISSION_LIMIT);
  }
}

export async function reserveJudgeRunQuota(
  repository: MissionRepository,
  input: { codeHash: string },
): Promise<QuotaReservation> {
  try {
    return await repository.reserveJudgeRun(input);
  } catch (error) {
    denyOnQuotaError(error, "judge", DEFAULT_JUDGE_RUN_LIMIT);
  }
}
