import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovalStatus,
  AuthorityPolicy,
  MissionApproval,
  MissionEvent,
  MissionEventType,
} from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  internalFixtureAdapter,
} from "./adapters/internal-fixture";
import { CapabilityRegistry } from "./capability-registry";
import { runExecuteNode, type ExecuteNodeInput } from "./execute-node";
import { nodeRequestedEventId, type NodeRequestedPayload } from "./inngest/dispatch";
import { InMemoryPersistence } from "./persistence/in-memory-persistence";

/**
 * The in-memory double is deliberately minimal, but the resume invariant only
 * holds because of two behaviors the SQL layer actually has (see
 * supabase/migrations/20260826000200_transactions_and_guards.sql):
 *
 *   1. `request_mission_approval` looks the approval up by the request event's
 *      idempotency key and RETURNS the existing row without appending a second
 *      `approval.requested` event.
 *   2. `append_mission_event` checks the idempotency key BEFORE the sequence
 *      guard and replays the stored event when type + payload match.
 *
 * Without both, a test could not tell a pause-loop from correct behavior, so
 * they are mirrored here rather than assumed away.
 */
class ApprovalGatePersistence extends InMemoryPersistence {
  private readonly approvalsByRequestKey = new Map<string, MissionApproval>();

  override async appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    if (command.idempotencyKey) {
      const stored = this.events.find((event) => event.idempotencyKey === command.idempotencyKey);
      if (stored) {
        assert.equal(stored.type, command.type, "idempotency key reused for a different event type");
        assert.deepEqual(stored.payload, command.payload, "idempotency key reused for a different payload");
        return stored;
      }
    }
    return super.appendEvent(command);
  }

  override async requestApproval(command: RequestApprovalCommand): Promise<MissionApproval> {
    const existing = this.approvalsByRequestKey.get(command.idempotencyKey);
    if (existing) return existing;
    const approval = await super.requestApproval(command);
    this.approvalsByRequestKey.set(command.idempotencyKey, approval);
    return approval;
  }

  /** Stands in for `POST /api/approvals/:approvalId/resolve`. */
  settleAll(status: ApprovalStatus): void {
    for (const approval of this.approvalsByRequestKey.values()) {
      approval.status = status;
      approval.resolvedAt = new Date().toISOString();
    }
  }

  /** The mission's current last sequence, as a resume dispatch would read it. */
  lastSequence(): number {
    return this.events.length === 0 ? 0 : this.events[this.events.length - 1].sequence;
  }

  count(type: MissionEventType): number {
    return this.events.filter((event) => event.type === type).length;
  }
}

function approvalGateInput(overrides: Partial<ExecuteNodeInput> = {}): ExecuteNodeInput {
  return {
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    node: {
      clientId: "node-1",
      codename: "scout",
      roleLabel: "Scout",
      objective: "Research relocation fixtures",
      capabilityNames: ["internal.echo_research"],
    },
    mandateVersion: 1,
    authority: {
      freePassage: true,
      allowedCapabilityIds: [INTERNAL_FIXTURE_CAPABILITY_ID],
      allowedOrigins: [INTERNAL_FIXTURE_ORIGIN],
      allowedTargets: [INTERNAL_FIXTURE_CAPABILITY_ID],
      allowedRiskLevels: ["low", "medium", "high", "critical"],
      maxAutonomousCostMicrounits: 1_000,
      allowExternalSideEffects: true,
      // This is what drives the policy engine to `require_approval`.
      requireApprovalCategories: ["read"],
    } satisfies AuthorityPolicy,
    budgetLimits: {},
    expectedSequence: 0,
    correlationId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

function registryWithFixture(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(internalFixtureAdapter);
  return registry;
}

/** Runs the node once, leaving it paused on a pending approval. */
async function pauseOnApproval(persistence: ApprovalGatePersistence) {
  const result = await runExecuteNode(approvalGateInput(), {
    persistence,
    registry: registryWithFixture(),
  });
  assert.equal(result.status, "approval_required");
  return result;
}

/** Redispatches the node the way `resumeApprovedNode` does. */
function resumeRun(persistence: ApprovalGatePersistence) {
  return runExecuteNode(approvalGateInput({ expectedSequence: persistence.lastSequence() }), {
    persistence,
    registry: registryWithFixture(),
  });
}

test("resume: a settled-accepted approval executes the capability without pausing again", async () => {
  const persistence = new ApprovalGatePersistence();
  const paused = await pauseOnApproval(persistence);
  persistence.settleAll("resolved");

  const resumed = await resumeRun(persistence);

  assert.equal(resumed.status, "completed");
  assert.ok(resumed.emittedEventTypes.includes("tool.completed"), "the held capability must actually run");
  assert.ok(!resumed.emittedEventTypes.includes("node.paused"), "a settled approval must not pause the node");
  assert.equal(persistence.count("node.paused"), 1, "only the original pause is durable");
  assert.equal(persistence.count("approval.requested"), 1, "the gate must not request a second approval");
  assert.equal(persistence.approvals.length, 1);
  assert.equal(persistence.approvals[0].id, paused.approvalId);
});

test("resume: a rejected approval fails the node once, even when the resume is delivered twice", async () => {
  const persistence = new ApprovalGatePersistence();
  await pauseOnApproval(persistence);
  persistence.settleAll("rejected");

  const first = await resumeRun(persistence);
  const second = await resumeRun(persistence);

  assert.equal(first.status, "failed");
  assert.equal(second.status, "failed");
  const failures = persistence.events.filter((event) => event.type === "node.failed");
  assert.equal(failures.length, 1, "duplicate delivery must replay, not append a second failure");
  assert.deepEqual(failures[0].payload, {
    nodeId: "node-1",
    reason: "approval_rejected",
    approvalId: persistence.approvals[0].id,
  });
  assert.equal(persistence.count("tool.started"), 0, "a rejected action must never execute");
});

test("resume: a still-pending approval replay pauses once and requests no second approval", async () => {
  const persistence = new ApprovalGatePersistence();
  await pauseOnApproval(persistence);

  const replay = await resumeRun(persistence);

  assert.equal(replay.status, "approval_required");
  assert.equal(persistence.count("node.paused"), 1, "the approval-keyed pause makes redelivery a no-op");
  assert.equal(persistence.count("approval.requested"), 1);
  assert.equal(persistence.approvals.length, 1);
  assert.equal(persistence.count("tool.started"), 0);
});

test("resume dispatch id differs from the original node dispatch id", () => {
  const payload: NodeRequestedPayload = {
    missionId: "mission-1",
    tenantId: "tenant-1",
    identityId: "user-1",
    nodeId: "node-1",
    node: {
      clientId: "node-1",
      codename: "scout",
      roleLabel: "Scout",
      objective: "Research relocation fixtures",
      capabilityNames: ["internal.echo_research"],
    },
    mandateVersion: 1,
    expectedSequence: 5,
    authority: approvalGateInput().authority,
    budgetLimits: {},
    actor: { kind: "cardea", id: "mission-planner" },
    correlationId: "11111111-1111-1111-1111-111111111111",
  };

  const original = nodeRequestedEventId(payload);
  const resume = nodeRequestedEventId({ ...payload, resumeOfApprovalId: "approval-1" });

  assert.equal(original, "node-requested:mission-1:node-1:v1");
  assert.notEqual(resume, original, "Inngest would otherwise dedupe the resume against the first dispatch");
  assert.equal(resume, "node-requested:mission-1:node-1:v1:resume:approval-1");
});
