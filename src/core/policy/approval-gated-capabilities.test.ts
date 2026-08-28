import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MISSION_AUTHORITY } from "../contracts/mission-data-source";
import {
  COMPOSIO_APPROVAL_GATED_CAPABILITIES,
  COMPOSIO_PROVIDER_ORIGIN,
  CART_PERMALINK_CAPABILITY_ID,
  CART_PERMALINK_ORIGIN,
  DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS,
  shopifyStoreOrigin,
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
    DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  );
  for (const capability of COMPOSIO_APPROVAL_GATED_CAPABILITIES) {
    assert.ok(DEFAULT_APPROVAL_GATED_CAPABILITY_IDS.includes(capability.id));
  }
  for (const id of SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS) {
    assert.ok(DEFAULT_APPROVAL_GATED_CAPABILITY_IDS.includes(id));
  }
});

/* -------------------------------------------------------------------------- */
/* Storefront cart writes sit on the same hinge                               */
/* -------------------------------------------------------------------------- */

/**
 * The storefront adapter tags each capability with the store's own origin, so
 * these cases add that origin to the mandate the way a deployment with
 * `CARDEA_SHOPIFY_STORE_DOMAIN` set does, and then assert the *gate* rather
 * than the configuration.
 */
const STORE_ORIGIN = shopifyStoreOrigin("example-store.com");

function storefrontAuthority() {
  assert.equal(typeof STORE_ORIGIN, "string");
  return {
    ...DEFAULT_MISSION_AUTHORITY,
    allowedOrigins: [...DEFAULT_MISSION_AUTHORITY.allowedOrigins, STORE_ORIGIN as string],
  };
}

for (const capabilityId of SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS) {
  test(`default mandate requires approval for ${capabilityId}`, () => {
    const decision = evaluatePolicy(
      writeInput(capabilityId, {
        mandate: { version: 1, authority: storefrontAuthority() },
        origin: STORE_ORIGIN as string,
      }),
    );
    assert.equal(decision.effect, "require_approval");
    assert.equal(decision.code, "approval_gated_capability");
  });

  test(`Free Passage cannot authorize ${capabilityId} on its own`, () => {
    const decision = evaluatePolicy(
      writeInput(capabilityId, {
        mandate: {
          version: 1,
          authority: {
            ...storefrontAuthority(),
            freePassage: true,
            allowExternalSideEffects: true,
            maxAutonomousCostMicrounits: 1_000_000,
            allowedRiskLevels: ["low", "medium", "high", "critical"],
            requireApprovalCategories: [],
          },
        },
        origin: STORE_ORIGIN as string,
      }),
    );
    assert.equal(decision.effect, "require_approval");
    assert.equal(decision.code, "approval_gated_capability");
  });
}

test("a storefront checkout capability is not admitted at all", () => {
  const decision = evaluatePolicy(
    writeInput("shopify.complete_checkout", {
      mandate: { version: 1, authority: storefrontAuthority() },
      origin: STORE_ORIGIN as string,
    }),
  );
  assert.equal(decision.effect, "deny");
  assert.equal(decision.code, "capability_not_allowed");
});

test("a storefront capability from an unadmitted origin is refused", () => {
  const decision = evaluatePolicy(
    writeInput(SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS[0], {
      origin: "https://some-other-store.example",
    }),
  );
  assert.equal(decision.effect, "deny");
  assert.equal(decision.code, "origin_not_allowed");
});

test("the cart permalink capability is a plain read inside the mandate", () => {
  const decision = evaluatePolicy({
    ...writeInput(CART_PERMALINK_CAPABILITY_ID),
    capability: {
      id: CART_PERMALINK_CAPABILITY_ID,
      riskLevel: "low",
      riskCategories: ["read"],
      trust: "derived",
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
      fingerprint: "permalink000000000000000000000000000",
      estimatedCostMicrounits: 0,
    },
    origin: CART_PERMALINK_ORIGIN,
  });
  assert.equal(decision.effect, "allow");
  assert.equal(decision.code, "within_mandate");
});
