import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  denyAccountDeletionConfirmation,
  denyAccountDeletionPrincipal,
} from "./account-deletion";

test("only a signed-in user may delete an account", () => {
  assert.equal(denyAccountDeletionPrincipal("user"), null);
});

test("guest, judge, and anonymous principals are denied with 401", () => {
  for (const kind of ["guest", "judge", "anonymous"] as const) {
    const denial = denyAccountDeletionPrincipal(kind);
    assert.ok(denial, `${kind} should be denied`);
    assert.equal(denial.status, 401);
    assert.equal(denial.error, "authentication_required");
    assert.ok(denial.reason.length > 0);
  }
});

test("guest and judge denials say there is no account rather than implying one", () => {
  assert.match(denyAccountDeletionPrincipal("guest")!.reason, /no Cardea account/);
  assert.match(denyAccountDeletionPrincipal("judge")!.reason, /no Cardea account/);
  assert.match(denyAccountDeletionPrincipal("anonymous")!.reason, /no session/);
});

test("the exact confirmation phrase passes", () => {
  assert.equal(denyAccountDeletionConfirmation({ confirm: ACCOUNT_DELETION_CONFIRMATION }), null);
});

test("extra keys alongside a valid confirmation are ignored", () => {
  assert.equal(
    denyAccountDeletionConfirmation({ confirm: ACCOUNT_DELETION_CONFIRMATION, userId: "someone-else" }),
    null,
  );
});

test("a near-miss confirmation is rejected with 400", () => {
  const nearMisses: unknown[] = [
    { confirm: "Delete My Account" },
    { confirm: " delete my account" },
    { confirm: "delete my account " },
    { confirm: "delete my accounts" },
    { confirm: "" },
    { confirm: true },
    { confirm: null },
    {},
  ];
  for (const body of nearMisses) {
    const denial = denyAccountDeletionConfirmation(body);
    assert.ok(denial, `${JSON.stringify(body)} should be rejected`);
    assert.equal(denial.status, 400);
    assert.equal(denial.error, "confirmation_required");
  }
});

test("a non-object body is an invalid request", () => {
  for (const body of [null, undefined, "delete my account", 7, [ACCOUNT_DELETION_CONFIRMATION]]) {
    const denial = denyAccountDeletionConfirmation(body);
    assert.ok(denial, `${JSON.stringify(body ?? null)} should be rejected`);
    assert.equal(denial.status, 400);
    assert.equal(denial.error, "invalid_request");
  }
});
