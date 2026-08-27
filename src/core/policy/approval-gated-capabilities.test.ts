import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MISSION_AUTHORITY } from "../contracts/mission-data-source";
import {
  COMPOSIO_APPROVAL_GATED_CAPABILITIES,
  COMPOSIO_PROVIDER_ORIGIN,
} from "../contracts/safe-capabilities";
import { evaluatePolicy, type PolicyInput } from "./engine";

/**
 * The proof that Cardea's two write capabilities are gated by the policy
 * engine itself, under the mandate a mission actually gets, rather than by
 * anything a caller remembers to do. Every assertion here runs the real
 * `DEFAULT_MISSION_AUTHORITY`.
 */
function writeInput(capabilityId: string, overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mandate: { version: 1, authority: DEFAULT_MISSION_AUTHORITY },
    userAuthority: { authenticated: true, canTakeover: true, reauthenticatedForAction: false },
    contextCardOverrides: [],
    capability: {
      id: capabilityId,
      riskLevel: "medium",
      riskCategories: ["external_write"],
      trust: "derived",
    },
    tool: {
      readOnly: false,
      destructive: false,
      idempotent: false,
      externalSideEffect: true,
      sensitive: false,
      requiresUserPresence: false,
    },
    action: {
      category: "external_write",
      fingerprint: "write0000000000000000000000000000000",
      estimatedCostMicrounits: 0,
    },
    origin: COMPOSIO_PROVIDER_ORIGIN,
    target: capabilityId,
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

for (const capability of COMPOSIO_APPROVAL_GATED_CAPABILITIES) {
  test(`default mandate requires approval for ${capability.id}`, () => {
    const decision = evaluatePolicy(writeInput(capability.id));
    assert.equal(decision.effect, "require_approval");
    assert.equal(decision.code, "approval_gated_capability");
  });

  test(`Free Passage cannot authorize ${capability.id} on its own`, () => {
    const decision = evaluatePolicy(
      writeInput(capability.id, {
        mandate: {
          version: 1,
          authority: {
            ...DEFAULT_MISSION_AUTHORITY,
            freePassage: true,
            allowExternalSideEffects: true,
            maxAutonomousCostMicrounits: 1_000_000,
            allowedRiskLevels: ["low", "medium", "high", "critical"],
            requireApprovalCategories: [],
          },
        },
      }),
    );
    assert.equal(decision.effect, "require_approval");
    assert.equal(decision.code, "approval_gated_capability");
  });

  test(`an exact accepted approval lets ${capability.id} through exactly once`, () => {
    const base = writeInput(capability.id);
    const decision = evaluatePolicy({
      ...base,
      priorApproval: {
        status: "approved",
        actionFingerprint: base.action.fingerprint,
        mandateVersion: 1,
        stillValid: true,
      },
    });
    assert.equal(decision.effect, "allow");
    assert.equal(decision.code, "approved_exact_action");

    // A different action under the same approval is not covered by it.
    const otherAction = evaluatePolicy({
      ...base,
      action: { ...base.action, fingerprint: "other0000000000000000000000000000000" },
      priorApproval: {
        status: "approved",
        actionFingerprint: base.action.fingerprint,
        mandateVersion: 1,
        stillValid: true,
      },
    });
    assert.equal(otherAction.effect, "require_approval");
  });
}

test("the approval gate is by enumerated id, not a widened risk ceiling", () => {
  // Same medium risk, same mandate, but the id was never admitted to
  // `approvalGatedCapabilityIds` — the mandate's low-risk ceiling still denies.
  const notGated = "composio.googlecalendar_delete_event";
  const decision = evaluatePolicy(
    writeInput(notGated, {
      mandate: {
        version: 1,
        authority: {
          ...DEFAULT_MISSION_AUTHORITY,
          allowedCapabilityIds: [...DEFAULT_MISSION_AUTHORITY.allowedCapabilityIds, notGated],
          allowedTargets: [...DEFAULT_MISSION_AUTHORITY.allowedTargets, notGated],
        },
      },
    }),
  );
  assert.equal(decision.effect, "deny");
  assert.equal(decision.code, "risk_not_authorized");
});

test("an unlisted write capability is still denied outright", () => {
  const decision = evaluatePolicy(writeInput("composio.gmail_send_email"));
  assert.equal(decision.effect, "deny");
  assert.equal(decision.code, "capability_not_allowed");
  assert.equal(decision.permanentHardStop, true);
});

test("a payment action stays a permanent hard stop even on a gated capability", () => {
  const capabilityId = COMPOSIO_APPROVAL_GATED_CAPABILITIES[0].id;
  const decision = evaluatePolicy(
    writeInput(capabilityId, {
      action: {
        category: "payment_or_purchase",
        fingerprint: "payment00000000000000000000000000000",
        estimatedCostMicrounits: 10,
      },
    }),
  );
  assert.equal(decision.effect, "require_approval");
  assert.equal(decision.code, "permanent_hard_stop");
  assert.equal(decision.permanentHardStop, true);
});

test("the default mandate keeps its read-only autonomy limits unchanged", () => {
  assert.deepEqual(DEFAULT_MISSION_AUTHORITY.allowedRiskLevels, ["low"]);
  assert.equal(DEFAULT_MISSION_AUTHORITY.allowExternalSideEffects, false);
  assert.equal(DEFAULT_MISSION_AUTHORITY.maxAutonomousCostMicrounits, 0);
  assert.equal(DEFAULT_MISSION_AUTHORITY.freePassage, false);
  assert.deepEqual(
    DEFAULT_MISSION_AUTHORITY.approvalGatedCapabilityIds,
    COMPOSIO_APPROVAL_GATED_CAPABILITIES.map((capability) => capability.id),
  );
});
