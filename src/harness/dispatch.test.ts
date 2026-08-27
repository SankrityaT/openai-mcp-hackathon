import assert from "node:assert/strict";
import test from "node:test";
import {
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
