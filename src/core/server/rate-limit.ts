/**
 * Instance-local (per-process, per-instance) sliding-window rate limiter.
 *
 * This is a coarse, cheap first line of defense against request bursts. It
 * lives entirely in process memory: a multi-instance deployment (e.g. more
 * than one live Vercel instance) does not share this state across
 * instances, nor does it survive a cold restart, so it must never be
 * treated as the authoritative quota. The durable, per-day/guest/judge
 * allowances enforced through `mission-quota.ts` and the `usage_ledger` /
 * `guest_sessions` / `judge_access` tables remain the source of truth for
 * "how much is this principal allowed"; this module only takes burst
 * pressure off them and off downstream providers before a request reaches
 * any database or provider call. It complements those durable DB quotas —
 * it does not replace them, and it is not a distributed rate limit. This is
 * a known, documented MVP limitation (see `docs/SECURITY_REVIEW_BE08.md`,
 * finding 6), not a bug: the judge-redeem budget it protects most tightly
 * is low-impact per-instance because the judge code itself is a full
 * SHA-256 preimage (brute force is infeasible regardless of how the
 * request budget is partitioned across instances).
 *
 * It intentionally does not import `server-only` so the sliding-window
 * primitives stay unit-testable under `node --test`, matching the existing
 * convention in `credentials.ts`. Every export here is a pure function of
 * its arguments plus the module-local store; nothing reads cookies, headers,
 * or environment configuration.
 */

import { buildQuotaDenial, QUOTA_DENIED_STATUS } from "../contracts/quota-errors";

export type RateLimitRouteClass =
  | "mission_create"
  | "guest_session"
  | "judge_redeem"
  | "event_append"
  | "memory"
  | "composio"
  | "notifications"
  | "agent_plan"
  | "standing_mission"
  | "account_deletion"
  | "indexnow";

export type RateLimitBudget = {
  /** Maximum requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/**
 * Per-route budgets. Values are conservative MVP defaults, not tuned SLOs:
 *
 * | Route class      | Budget    | Surface                                            |
 * |-------------------|-----------|-----------------------------------------------------|
 * | mission_create     | 10 / min  | POST /api/missions                                  |
 * | guest_session      | 5 / min   | POST /api/guest/session                             |
 * | judge_redeem       | 5 / min   | POST /api/judge/redeem (code-guessing surface)      |
 * | event_append       | 60 / min  | POST /api/missions/[missionId]/events               |
 * | memory             | 30 / min  | POST /api/memory/{search,update,promote,forget}     |
 * | composio           | 30 / min  | POST /api/integrations/composio/{authorize,session} |
 * | notifications      | 30 / min  | GET/POST/DELETE /api/notifications/email             |
 * | standing_mission   | 20 / min  | GET/POST /api/standing-missions, PATCH/DELETE /[id] |
 * | account_deletion   | 3 / min   | DELETE /api/account                                 |
 *
 * `standing_mission` covers the whole standing-missions surface with one
 * budget. It is looser than `mission_create` because listing and toggling are
 * cheap reads and single-row writes, and tighter than `event_append` because
 * creating one still opens a durable schedule. No request on this surface
 * runs a mission or spends at the provider — the sweep does that, on its own
 * cron, metered by the owner's durable daily mission quota.
 */
export const RATE_LIMIT_BUDGETS: Readonly<Record<RateLimitRouteClass, RateLimitBudget>> = {
  mission_create: { limit: 10, windowMs: 60_000 },
  guest_session: { limit: 5, windowMs: 60_000 },
  judge_redeem: { limit: 5, windowMs: 60_000 },
  event_append: { limit: 60, windowMs: 60_000 },
  memory: { limit: 30, windowMs: 60_000 },
  composio: { limit: 30, windowMs: 60_000 },
  // Toggling a reach-me preference costs one small write; the budget is here
  // to stop a stuck client from hammering the row, not to ration the person.
  notifications: { limit: 30, windowMs: 60_000 },
  // Direct planner invocation drives real model spend; authenticated only,
  // and kept tight because each call is expensive.
  agent_plan: { limit: 5, windowMs: 60_000 },
  standing_mission: { limit: 20, windowMs: 60_000 },
  // Erasure is irreversible and a caller only ever needs it once. The budget
  // is deliberately the tightest here: it is a brake on a stuck client or a
  // scripted sweep, not a ration on a person leaving.
  account_deletion: { limit: 3, windowMs: 60_000 },
  // Each call spends a third party's quota (IndexNow rate-limits per host), so
  // the brake is on our own outbound volume rather than on the caller. The
  // route takes no input and only ever submits Cardea's own public routes, so
  // this needs to stop a loop, not an attacker.
  indexnow: { limit: 3, windowMs: 60_000 },
};

export type RateLimitResult = {
  allowed: boolean;
  routeClass: RateLimitRouteClass;
  limit: number;
  used: number;
  retryAfterSeconds: number | null;
};

/** `${routeClass}:${identity}` -> ascending timestamps (ms) within the live window. */
const store = new Map<string, number[]>();

/** Bounds unbounded growth from many distinct identities over a long-lived instance. */
const MAX_TRACKED_KEYS = 10_000;
let opsSinceSweep = 0;

function sweepIfDue(now: number): void {
  opsSinceSweep += 1;
  if (store.size <= MAX_TRACKED_KEYS && opsSinceSweep < 500) return;
  opsSinceSweep = 0;
  for (const [key, timestamps] of store) {
    const routeClass = key.slice(0, key.indexOf(":")) as RateLimitRouteClass;
    const budget = RATE_LIMIT_BUDGETS[routeClass];
    const windowStart = now - (budget?.windowMs ?? 0);
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
      store.delete(key);
    }
  }
}

/**
 * Checks and, when allowed, records one request against `routeClass` for
 * `identity` (typically a hashed IP abuse signal; falls back to a shared
 * `"anon"` bucket when no signal is available, e.g. in local dev without a
 * forwarding proxy). `now` is injectable for deterministic tests.
 */
export function checkRateLimit(
  routeClass: RateLimitRouteClass,
  identity: string | undefined,
  now: number = Date.now(),
): RateLimitResult {
  const budget = RATE_LIMIT_BUDGETS[routeClass];
  const key = `${routeClass}:${identity ?? "anon"}`;
  const windowStart = now - budget.windowMs;
  const existing = store.get(key) ?? [];
  const kept = existing.filter((timestamp) => timestamp > windowStart);

  if (kept.length >= budget.limit) {
    store.set(key, kept);
    sweepIfDue(now);
    const oldest = kept[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + budget.windowMs - now) / 1000));
    return { allowed: false, routeClass, limit: budget.limit, used: kept.length, retryAfterSeconds };
  }

  kept.push(now);
  store.set(key, kept);
  sweepIfDue(now);
  return { allowed: true, routeClass, limit: budget.limit, used: kept.length, retryAfterSeconds: null };
}

/** Test-only: clears all tracked buckets so tests do not leak state into each other. */
export function clearRateLimitStoreForTests(): void {
  store.clear();
  opsSinceSweep = 0;
}

/**
 * Builds the 429 response for a denied check. The body shape matches the
 * existing `QuotaDenial` contract (`error: "quota_denied"`) so clients that
 * already handle durable quota denials handle an instance-local rate-limit
 * denial the same way. `scope: "provider"` is reused rather than adding a
 * new `QuotaSubjectScope` member: a rate-limit trip is an abuse-signal
 * ceiling on the serving instance, not a specific user/guest/judge/mission
 * allowance, and "provider" is the closest existing scope for that kind of
 * instance-level circuit breaker.
 */
export function rateLimitDenialResponse(result: RateLimitResult): Response {
  const denial = buildQuotaDenial({
    scope: "provider",
    metric: `rate_limit.${result.routeClass}`,
    limit: result.limit,
    used: result.used,
    retryAfterSeconds: result.retryAfterSeconds,
  });
  const headers = new Headers({ "Cache-Control": "private, no-store, max-age=0" });
  if (result.retryAfterSeconds !== null) {
    headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  return Response.json(denial, { status: QUOTA_DENIED_STATUS, headers });
}

/**
 * Convenience combinator for route handlers: returns a ready-to-return 429
 * `Response` when the request is over budget, or `null` to continue.
 *
 * ```ts
 * const limited = enforceRateLimit("mission_create", readIpSignalHash(request));
 * if (limited) return limited;
 * ```
 */
export function enforceRateLimit(
  routeClass: RateLimitRouteClass,
  identity: string | undefined,
  now?: number,
): Response | null {
  const result = checkRateLimit(routeClass, identity, now);
  return result.allowed ? null : rateLimitDenialResponse(result);
}
