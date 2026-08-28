import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePolicy, type PolicyInput } from "../policy/engine";
import { DEFAULT_MISSION_AUTHORITY } from "./mission-data-source";
import {
  DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  DEFAULT_SAFE_CAPABILITY_IDS,
  DEFAULT_SAFE_CAPABILITY_ORIGINS,
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_LOOKUP_ORIGIN,
} from "./safe-capabilities";

test("the web lookup is a reviewed safe read, not an approval-gated write", () => {
  assert.ok(DEFAULT_SAFE_CAPABILITY_IDS.includes(WEB_LOOKUP_CAPABILITY_ID));
  const gated: string[] = [...DEFAULT_APPROVAL_GATED_CAPABILITY_IDS];
  assert.ok(!gated.includes(WEB_LOOKUP_CAPABILITY_ID));
  assert.ok(DEFAULT_SAFE_CAPABILITY_ORIGINS.includes(WEB_LOOKUP_ORIGIN));
});

test("the web lookup id is composio-free, so it cannot borrow the composio surface", () => {
  assert.ok(!WEB_LOOKUP_CAPABILITY_ID.startsWith("composio."));
});

test("the default mandate admits the web lookup as a capability, an origin, and a target", () => {
  assert.ok(DEFAULT_MISSION_AUTHORITY.allowedCapabilityIds.includes(WEB_LOOKUP_CAPABILITY_ID));
  assert.ok(DEFAULT_MISSION_AUTHORITY.allowedOrigins.includes(WEB_LOOKUP_ORIGIN));
  // execute-node passes the capability id as the policy target.
  assert.ok(DEFAULT_MISSION_AUTHORITY.allowedTargets.includes(WEB_LOOKUP_CAPABILITY_ID));
});

/**
 * The shape execute-node builds for this capability: a low-risk read whose
 * *descriptor* is derived (Cardea's own navigate-and-read function) even
 * though the evidence it brings back is labelled untrusted downstream.
 */
function webLookupPolicyInput(): PolicyInput {
  return {
    mandate: { version: 1, authority: DEFAULT_MISSION_AUTHORITY },
    userAuthority: { authenticated: true, canTakeover: true, reauthenticatedForAction: false },
    contextCardOverrides: [],
    capability: {
      id: WEB_LOOKUP_CAPABILITY_ID,
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
      fingerprint: "idem_web_lookup_fingerprint_0001",
      estimatedCostMicrounits: 0,
    },
    origin: WEB_LOOKUP_ORIGIN,
    target: WEB_LOOKUP_CAPABILITY_ID,
    quota: { exhausted: false },
    budget: {
      exhausted: false,
      estimatedCostMicrounits: 0,
      spentCostMicrounits: 0,
      limitCostMicrounits: 1_000_000,
    },
    idempotencyState: "new",
  };
}

test("a web lookup runs inside the default mandate without stopping for approval", () => {
  const decision = evaluatePolicy(webLookupPolicyInput());
  assert.equal(decision.effect, "allow");
  assert.equal(decision.code, "within_mandate");
});

test("a web lookup with an unlisted origin is refused, not quietly allowed", () => {
  const decision = evaluatePolicy({
    ...webLookupPolicyInput(),
    origin: "https://somewhere.example.com",
  });
  assert.equal(decision.effect, "deny");
  assert.equal(decision.code, "origin_not_allowed");
});
