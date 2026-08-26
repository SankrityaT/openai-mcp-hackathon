export const DEFAULT_GUEST_MISSION_LIMIT = 1;
export const DEFAULT_JUDGE_RUN_LIMIT = 10;

export type UsageLimit = {
  metric: string;
  used: number;
  pending: number;
  limit: number;
};

export type CostLimit = {
  spentMicrounits: number;
  estimatedMicrounits: number;
  limitMicrounits: number;
};

export type LimitDecision =
  | { allowed: true; nextUsed: number; nextSpentMicrounits: number }
  | { allowed: false; code: "quota_exhausted" | "cost_budget_exhausted" };

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function evaluateUsageAndCostLimit(
  usage: UsageLimit,
  cost: CostLimit,
): LimitDecision {
  for (const [name, value] of Object.entries({
    used: usage.used,
    pending: usage.pending,
    limit: usage.limit,
    spentMicrounits: cost.spentMicrounits,
    estimatedMicrounits: cost.estimatedMicrounits,
    limitMicrounits: cost.limitMicrounits,
  })) {
    assertNonNegativeSafeInteger(value, name);
  }
  const nextUsed = usage.used + usage.pending;
  if (nextUsed > usage.limit) {
    return { allowed: false, code: "quota_exhausted" };
  }
  const nextSpentMicrounits = cost.spentMicrounits + cost.estimatedMicrounits;
  if (nextSpentMicrounits > cost.limitMicrounits) {
    return { allowed: false, code: "cost_budget_exhausted" };
  }
  return { allowed: true, nextUsed, nextSpentMicrounits };
}

export function canReadTenant(
  actorUserId: string | null,
  tenant: { ownerUserId: string | null; memberUserIds: readonly string[]; scope: string },
): boolean {
  if (tenant.scope === "public_fixture") return true;
  if (!actorUserId) return false;
  return tenant.ownerUserId === actorUserId || tenant.memberUserIds.includes(actorUserId);
}

export function canWriteTenant(
  actorUserId: string | null,
  tenant: { ownerUserId: string | null; writableMemberUserIds: readonly string[]; scope: string },
): boolean {
  if (!actorUserId || tenant.scope === "public_fixture") return false;
  return tenant.ownerUserId === actorUserId || tenant.writableMemberUserIds.includes(actorUserId);
}
