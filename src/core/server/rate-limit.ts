/**
 * Instance-local sliding-window rate limiter.
 *
 * This is a coarse, cheap first line of defense against request bursts. It
 * lives entirely in process memory: a multi-instance deployment (or a cold
 * restart) does not share state, so it must never be treated as the
 * authoritative quota. The durable, per-day/guest/judge allowances enforced
 * through `mission-quota.ts` and the `usage_ledger` / `guest_sessions` /
 * `judge_access` tables remain the source of truth; this module only takes
 * pressure off them and off downstream providers before a request reaches
 * any database or provider call.
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
  | "composio";

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
 */
export const RATE_LIMIT_BUDGETS: Readonly<Record<RateLimitRouteClass, RateLimitBudget>> = {
  mission_create: { limit: 10, windowMs: 60_000 },
  guest_session: { limit: 5, windowMs: 60_000 },
  judge_redeem: { limit: 5, windowMs: 60_000 },
  event_append: { limit: 60, windowMs: 60_000 },
  memory: { limit: 30, windowMs: 60_000 },
  composio: { limit: 30, windowMs: 60_000 },
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
