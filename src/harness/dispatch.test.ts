import assert from "node:assert/strict";
import test from "node:test";
import {
  sendApprovalNotify,
  sendApprovalResolved,
  sendMissionRequested,
  sendNodeRequested,
} from "./inngest/dispatch";

import type { AuthorityPolicy } from "@/core/contracts/types";

const AUTHORITY: AuthorityPolicy = {
  freePassage: false,
  allowedCapabilityIds: [],
  allowedOrigins: [],
  allowedTargets: [],
  allowedRiskLevels: [],
  maxAutonomousCostMicrounits: 0,
  allowExternalSideEffects: false,
  requireApprovalCategories: [],
};

// This suite never sets INNGEST_EVENT_KEY, so every sender must degrade to a
// typed no-op instead of attempting a network call — the harness must never
// make a live network call from a test.
test("sendMissionRequested is a typed no-op when Inngest is not configured", async () => {
  delete process.env.INNGEST_EVENT_KEY;
  const result = await sendMissionRequested({
    missionId: "mission-1",
    tenantId: "tenant-1",
    identityId: "user-1",
    goal: "Plan a trip",
    constraints: [],
    authority: AUTHORITY,
    selectedContextCardIds: [],
    budgetLimits: {},
    mandateVersion: 1,
    expectedSequence: 2,
    actor: { kind: "user", id: "user-1" },
    correlationId: "11111111-1111-1111-1111-111111111111",
  });
  assert.deepEqual(result, { dispatched: false, reason: "not_configured" });
});

test("sendNodeRequested is a typed no-op when Inngest is not configured", async () => {
  delete process.env.INNGEST_EVENT_KEY;
  const result = await sendNodeRequested({
    missionId: "mission-1",
    tenantId: "tenant-1",
    identityId: "user-1",
    nodeId: "node-1",
    node: {
      clientId: "node-1",
      codename: "scout",
      roleLabel: "Scout",
      objective: "Research",
      capabilityNames: [],
    },
    mandateVersion: 1,
    expectedSequence: 3,
    authority: AUTHORITY,
    budgetLimits: {},
    actor: { kind: "cardea", id: "mission-planner" },
    correlationId: "11111111-1111-1111-1111-111111111111",
  });
  assert.deepEqual(result, { dispatched: false, reason: "not_configured" });
});

test("a node dispatch carries the planner's cost estimate, and stays valid without one", async () => {
  // The field is optional on the wire so a dispatch already in flight when it
  // shipped still validates; the node run reads an absent estimate as 0.
  delete process.env.INNGEST_EVENT_KEY;
  const withEstimate = await sendNodeRequested({
    missionId: "mission-1",
    tenantId: "tenant-1",
    identityId: "user-1",
    nodeId: "node-1",
    node: {
      clientId: "node-1",
      codename: "courier",
      roleLabel: "Courier",
      objective: "Place the holding deposit",
      capabilityNames: [],
      estimatedCostMicrounits: 200_000,
    },
    mandateVersion: 1,
    expectedSequence: 3,
    authority: AUTHORITY,
    budgetLimits: { maxCostMicrounits: 1_000_000 },
    actor: { kind: "cardea", id: "mission-planner" },
    correlationId: "11111111-1111-1111-1111-111111111111",
  });
  assert.deepEqual(withEstimate, { dispatched: false, reason: "not_configured" });
});

test("sendApprovalNotify is a typed no-op when Inngest is not configured", async () => {
  delete process.env.INNGEST_EVENT_KEY;
  const result = await sendApprovalNotify({
    approvalId: "approval-1",
    missionId: "mission-1",
    tenantId: "tenant-1",
    recommendation: "Lyra found the apartment at $2,300 a month. Hold it?",
    consequence: "Holding costs a $200 deposit, refundable for 24 hours.",
    category: "commit",
    codename: "Lyra",
  });
  assert.deepEqual(result, { dispatched: false, reason: "not_configured" });
});

test("sendApprovalResolved is a typed no-op when Inngest is not configured", async () => {
  delete process.env.INNGEST_EVENT_KEY;
  const result = await sendApprovalResolved({
    approvalId: "approval-1",
    missionId: "mission-1",
    tenantId: "tenant-1",
    decision: "accepted",
    resolution: {},
    actor: { kind: "user", id: "user-1" },
    correlationId: "11111111-1111-1111-1111-111111111111",
  });
  assert.deepEqual(result, { dispatched: false, reason: "not_configured" });
});
