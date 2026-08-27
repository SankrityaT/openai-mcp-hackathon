import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRateLimit,
  clearRateLimitStoreForTests,
  enforceRateLimit,
  RATE_LIMIT_BUDGETS,
  rateLimitDenialResponse,
} from "./rate-limit";

test.beforeEach(() => {
  clearRateLimitStoreForTests();
});

test("allows a burst up to the configured budget", () => {
  const identity = "burst-identity";
  const { limit } = RATE_LIMIT_BUDGETS.judge_redeem;
  for (let i = 0; i < limit; i++) {
    const result = checkRateLimit("judge_redeem", identity, 1_000);
    assert.equal(result.allowed, true, `request ${i + 1} should be within budget`);
    assert.equal(result.used, i + 1);
    assert.equal(result.retryAfterSeconds, null);
  }
});

test("denies the request past the burst budget within the same window", () => {
  const identity = "over-budget-identity";
  const { limit, windowMs } = RATE_LIMIT_BUDGETS.judge_redeem;
  for (let i = 0; i < limit; i++) {
    assert.equal(checkRateLimit("judge_redeem", identity, 1_000).allowed, true);
  }
  const denied = checkRateLimit("judge_redeem", identity, 1_500);
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, limit);
  assert.equal(denied.used, limit);
  assert.ok(denied.retryAfterSeconds !== null && denied.retryAfterSeconds > 0);
  assert.ok(denied.retryAfterSeconds! <= Math.ceil(windowMs / 1000));
});

test("resets once the sliding window has fully elapsed", () => {
  const identity = "reset-identity";
  const { limit, windowMs } = RATE_LIMIT_BUDGETS.judge_redeem;
  for (let i = 0; i < limit; i++) {
    assert.equal(checkRateLimit("judge_redeem", identity, 0).allowed, true);
  }
  assert.equal(checkRateLimit("judge_redeem", identity, windowMs - 1).allowed, false);
  // Past the full window, the earliest timestamps have aged out.
  const afterWindow = checkRateLimit("judge_redeem", identity, windowMs + 1);
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.used, 1);
});

test("each route class and identity gets an independent bucket", () => {
  const { limit } = RATE_LIMIT_BUDGETS.mission_create;
  for (let i = 0; i < limit; i++) {
    assert.equal(checkRateLimit("mission_create", "shared-ip", 0).allowed, true);
  }
  assert.equal(checkRateLimit("mission_create", "shared-ip", 0).allowed, false);
  // Different route class, same identity: independent budget.
  assert.equal(checkRateLimit("guest_session", "shared-ip", 0).allowed, true);
  // Same route class, different identity: independent budget.
  assert.equal(checkRateLimit("mission_create", "other-ip", 0).allowed, true);
});

test("a missing identity falls back to one shared anonymous bucket", () => {
  const { limit } = RATE_LIMIT_BUDGETS.guest_session;
  for (let i = 0; i < limit; i++) {
    assert.equal(checkRateLimit("guest_session", undefined, 0).allowed, true);
  }
  assert.equal(checkRateLimit("guest_session", undefined, 0).allowed, false);
});

test("a denial response mirrors the existing quota-denied contract", async () => {
  const identity = "response-shape-identity";
  const { limit } = RATE_LIMIT_BUDGETS.judge_redeem;
  for (let i = 0; i < limit; i++) {
    checkRateLimit("judge_redeem", identity, 0);
  }
  const denied = checkRateLimit("judge_redeem", identity, 0);
  const response = rateLimitDenialResponse(denied);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), String(denied.retryAfterSeconds));
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.error, "quota_denied");
  assert.equal(body.scope, "provider");
  assert.equal(body.metric, "rate_limit.judge_redeem");
  assert.equal(body.limit, limit);
  assert.equal(body.used, limit);
});

test("enforceRateLimit is a null-or-429 combinator for route handlers", () => {
  const identity = "combinator-identity";
  const { limit } = RATE_LIMIT_BUDGETS.event_append;
  for (let i = 0; i < limit; i++) {
    assert.equal(enforceRateLimit("event_append", identity, 0), null);
  }
  const denial = enforceRateLimit("event_append", identity, 0);
  assert.ok(denial instanceof Response);
  assert.equal(denial!.status, 429);
});

test("judge redeem: a fake-request-driven integration check enforces 5/min", () => {
  // Mirrors how the route derives its identity: a hashed hop from
  // x-forwarded-for. We do not import readIpSignalHash's HMAC dependency
  // here (it needs session-cookie config); a stable stand-in string is
  // sufficient to exercise the same enforceRateLimit call the route makes.
  function fakeIdentityFor(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    return forwarded.split(",")[0]?.trim() || "anon";
  }

  const request = new Request("https://cardea.example/api/judge/redeem", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.42" },
  });
  const identity = fakeIdentityFor(request);
  const { limit } = RATE_LIMIT_BUDGETS.judge_redeem;

  for (let i = 0; i < limit; i++) {
    const blocked = enforceRateLimit("judge_redeem", identity, 0);
    assert.equal(blocked, null, `attempt ${i + 1} of ${limit} should pass`);
  }
  const blocked = enforceRateLimit("judge_redeem", identity, 0);
  assert.ok(blocked instanceof Response, "the 6th code-guess attempt in the window is blocked");
  assert.equal(blocked!.status, 429);

  // A different caller (different hashed IP) is unaffected.
  const otherRequest = new Request("https://cardea.example/api/judge/redeem", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
  assert.equal(enforceRateLimit("judge_redeem", fakeIdentityFor(otherRequest), 0), null);
});
