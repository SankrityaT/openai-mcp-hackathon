import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorityPolicy } from "../contracts/types";
import { evaluatePolicy, type PolicyInput } from "./engine";
import {
  canReadTenant,
  canWriteTenant,
  DEFAULT_GUEST_MISSION_LIMIT,
  DEFAULT_JUDGE_RUN_LIMIT,
  evaluateUsageAndCostLimit,
} from "./quota";

const authority: AuthorityPolicy = {
  freePassage: false,
  allowedCapabilityIds: ["capability-1"],
  allowedOrigins: ["https://allowed.example"],
  allowedTargets: ["record-1"],
  allowedRiskLevels: ["low", "medium", "high", "critical"],
  maxAutonomousCostMicrounits: 1_000,
  allowExternalSideEffects: false,
  requireApprovalCategories: [],
};

function policyInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mandate: { version: 1, authority },
    userAuthority: {
      authenticated: true,
      canTakeover: true,
      reauthenticatedForAction: false,
    },
    contextCardOverrides: [],
    capability: {
      id: "capability-1",
      riskLevel: "low",
      riskCategories: ["read"],
      trust: "trusted",
    },
    tool: {
      readOnly: true,
      destructive: false,
      idempotent: true,
      externalSideEffect: false,
      sensitive: false,
      requiresUserPresence: false,
    },
    action: {
      category: "read",
      fingerprint: "0123456789abcdef0123456789abcdef",
      estimatedCostMicrounits: 0,
    },
    origin: "https://allowed.example",
    target: "record-1",
    quota: { exhausted: false },
    budget: {
      exhausted: false,
      estimatedCostMicrounits: 0,
      spentCostMicrounits: 0,
      limitCostMicrounits: 10_000,
    },
    idempotencyState: "new",
    ...overrides,
  };
}

test("policy allows a bounded read", () => {
  assert.equal(evaluatePolicy(policyInput()).effect, "allow");
});

test("Free Passage cannot bypass a payment hard stop", () => {
  const input = policyInput({
    mandate: {
      version: 1,
      authority: {
        ...authority,
        freePassage: true,
        allowExternalSideEffects: true,
      },
    },
    tool: { ...policyInput().tool, readOnly: false, externalSideEffect: true },
    action: {
      category: "payment_or_purchase",
      fingerprint: "payment00000000000000000000000000000",
      estimatedCostMicrounits: 10,
    },
  });
  const result = evaluatePolicy(input);
  assert.equal(result.effect, "require_approval");
  assert.equal(result.permanentHardStop, true);
});

test("an exact approval is bound to fingerprint and mandate version", () => {
  const base = policyInput({
    action: {
      category: "sensitive_outbound_message",
      fingerprint: "message00000000000000000000000000000",
      estimatedCostMicrounits: 0,
    },
    tool: { ...policyInput().tool, readOnly: false, externalSideEffect: true, sensitive: true },
  });
  assert.equal(evaluatePolicy(base).effect, "require_approval");
  assert.equal(
    evaluatePolicy({
      ...base,
      priorApproval: {
        status: "approved",
        actionFingerprint: base.action.fingerprint,
        mandateVersion: 1,
        stillValid: true,
      },
    }).effect,
    "allow",
  );
  assert.equal(
    evaluatePolicy({
      ...base,
      priorApproval: {
        status: "approved",
        actionFingerprint: base.action.fingerprint,
        mandateVersion: 2,
        stillValid: true,
      },
    }).effect,
    "require_approval",
  );
});

test("origin and idempotency conflicts deny before execution", () => {
  assert.equal(
    evaluatePolicy(policyInput({ origin: "https://outside.example" })).code,
    "origin_not_allowed",
  );
  assert.equal(
    evaluatePolicy(policyInput({ idempotencyState: "conflict" })).code,
    "idempotency_conflict",
  );
  const replay = evaluatePolicy(policyInput({ idempotencyState: "succeeded" }));
  assert.equal(replay.effect, "allow");
  assert.equal(replay.replayExistingResult, true);
});

test("legal presence and account changes use takeover and reauthentication", () => {
  assert.equal(
    evaluatePolicy(policyInput({
      action: {
        category: "legal_agreement_or_signature",
        fingerprint: "legal0000000000000000000000000000000",
        estimatedCostMicrounits: 0,
      },
      tool: { ...policyInput().tool, readOnly: false, requiresUserPresence: true },
    })).effect,
    "require_takeover",
  );
  assert.equal(
    evaluatePolicy(policyInput({
      action: {
        category: "account_credential_or_permission_change",
        fingerprint: "account00000000000000000000000000000",
        estimatedCostMicrounits: 0,
      },
      tool: { ...policyInput().tool, readOnly: false, externalSideEffect: true },
    })).effect,
    "require_reauthentication",
  );
});

test("quota and cost primitives reject boundary overruns", () => {
  assert.equal(DEFAULT_GUEST_MISSION_LIMIT, 1);
  assert.equal(DEFAULT_JUDGE_RUN_LIMIT, 10);
  assert.deepEqual(
    evaluateUsageAndCostLimit(
      { metric: "mission", used: 1, pending: 1, limit: 1 },
      { spentMicrounits: 0, estimatedMicrounits: 0, limitMicrounits: 1 },
    ),
    { allowed: false, code: "quota_exhausted" },
  );
  assert.deepEqual(
    evaluateUsageAndCostLimit(
      { metric: "tool", used: 1, pending: 1, limit: 2 },
      { spentMicrounits: 8, estimatedMicrounits: 3, limitMicrounits: 10 },
    ),
    { allowed: false, code: "cost_budget_exhausted" },
  );
});

test("tenant checks deny cross-user access and public writes", () => {
  const privateTenant = {
    ownerUserId: "user-a",
    memberUserIds: ["user-c"],
    writableMemberUserIds: ["user-c"],
    scope: "user",
  };
  assert.equal(canReadTenant("user-a", privateTenant), true);
  assert.equal(canReadTenant("user-b", privateTenant), false);
  assert.equal(canWriteTenant("user-c", privateTenant), true);
  assert.equal(
    canWriteTenant("user-a", {
      ownerUserId: null,
      writableMemberUserIds: [],
      scope: "public_fixture",
    }),
    false,
  );
});
