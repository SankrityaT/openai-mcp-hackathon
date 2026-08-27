import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuotaDenial,
  describeQuotaDenial,
  isQuotaDatabaseErrorCode,
  mapDatabaseErrorToQuotaDenial,
  parseQuotaDenial,
  QUOTA_DENIED_STATUS,
  QuotaDeniedError,
} from "./quota-errors";

test("only the quota database code maps to a denial", () => {
  assert.equal(isQuotaDatabaseErrorCode("P0001"), true);
  assert.equal(isQuotaDatabaseErrorCode("42501"), false);
  assert.equal(isQuotaDatabaseErrorCode(undefined), false);

  assert.equal(
    mapDatabaseErrorToQuotaDenial({ code: "40001", scope: "user", metric: "mission.created" }),
    null,
  );
});

test("a quota database error becomes a structured denial", () => {
  const denial = mapDatabaseErrorToQuotaDenial({
    code: "P0001",
    scope: "guest",
    metric: "mission.created",
    limit: 1,
  });
  assert.deepEqual(denial, {
    error: "quota_denied",
    code: "quota_exhausted",
    scope: "guest",
    metric: "mission.created",
    limit: 1,
    used: null,
    retryAfterSeconds: null,
  });
});

test("the denial error carries its payload for the HTTP mapper", () => {
  const error = new QuotaDeniedError(
    buildQuotaDenial({ scope: "judge", metric: "mission.created", limit: 10, used: 10 }),
  );
  assert.equal(error.name, "QuotaDeniedError");
  assert.equal(error.denial.scope, "judge");
  assert.equal(error.denial.used, 10);
  assert.match(describeQuotaDenial(error.denial), /judge allowance for mission\.created/);
});

test("a cost denial is described separately from a count denial", () => {
  const denial = buildQuotaDenial({
    scope: "mission",
    metric: "model.tokens",
    code: "cost_budget_exhausted",
  });
  assert.match(describeQuotaDenial(denial), /cost budget/);
  assert.match(describeQuotaDenial(denial), /the configured allowance/);
});

test("clients only parse a denial from a real 429 quota response", () => {
  const body = {
    error: "quota_denied",
    code: "quota_exhausted",
    scope: "user",
    metric: "mission.created",
    limit: 25,
    used: 25,
    retryAfterSeconds: 60,
  };
  const parsed = parseQuotaDenial(QUOTA_DENIED_STATUS, body);
  assert.deepEqual(parsed, body);

  assert.equal(parseQuotaDenial(500, body), null);
  assert.equal(parseQuotaDenial(QUOTA_DENIED_STATUS, { error: "internal_error" }), null);
  assert.equal(parseQuotaDenial(QUOTA_DENIED_STATUS, null), null);
  assert.equal(parseQuotaDenial(QUOTA_DENIED_STATUS, [1, 2]), null);
});

test("unknown scope, code, and metric values are normalised rather than trusted", () => {
  const parsed = parseQuotaDenial(QUOTA_DENIED_STATUS, {
    error: "quota_denied",
    scope: "root",
    code: "made_up",
    metric: 42,
    limit: "many",
  });
  assert.deepEqual(parsed, {
    error: "quota_denied",
    code: "quota_exhausted",
    scope: "user",
    metric: "unknown",
    limit: null,
    used: null,
    retryAfterSeconds: null,
  });
});
