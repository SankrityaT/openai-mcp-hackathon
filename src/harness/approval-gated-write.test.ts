import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalStatus, MissionApproval, MissionEvent } from "@/core/contracts/types";
// Relative, not `@/...`: the harness test build is plain commonjs and never
// rewrites the path alias, so any *value* import must resolve on disk. See
// the note at the top of execute-node.ts.
import { DEFAULT_MISSION_AUTHORITY } from "../core/contracts/mission-data-source";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import type { CapabilityAdapter, CapabilityExecutionResult } from "./contracts";
import { CapabilityRegistry } from "./capability-registry";
import { runExecuteNode, type ExecuteNodeInput } from "./execute-node";
import { InMemoryPersistence } from "./persistence/in-memory-persistence";

const CAPABILITY_ID = "composio.googlecalendar_create_event";
const TOOL = "GOOGLECALENDAR_CREATE_EVENT";

/**
 * Mirrors the two SQL behaviors the approval gate depends on, exactly as
 * `approval-resume.test.ts` documents them: `request_mission_approval` is
 * idempotent on the request event's key, and `append_mission_event` replays a
 * stored event when the key, type, and payload all match. Duplicated here
 * rather than shared so the resume test's own double stays untouched.
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

  lastSequence(): number {
    return this.events.length === 0 ? 0 : this.events[this.events.length - 1].sequence;
  }
}

/** Counts real executions so a double-write cannot pass unnoticed. */
function writeAdapter(counter: { calls: number }): CapabilityAdapter {
  return {
    provider: "composio",
    async discover() {
      return [
        {
          id: CAPABILITY_ID,
          provider: "composio",
          name: TOOL,
          description: "Create one event in the connected calendar, only after approval.",
          inputSchema: {},
          risk: { level: "medium", categories: ["external_write"] },
          trust: { level: "derived", origin: "https://composio.dev" },
          readOnly: false,
        },
      ];
    },
    async execute(): Promise<CapabilityExecutionResult> {
      counter.calls += 1;
      return {
        executionId: "execution-1",
        output: { tool: TOOL, excerpt: "created", bytes: 7 },
        summary: "Completed the approved write.",
        provenance: `composio:${TOOL}`,
        trust: "untrusted",
      };
    },
  };
}

function writeNodeInput(overrides: Partial<ExecuteNodeInput> = {}): ExecuteNodeInput {
  return {
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    node: {
      clientId: "node-1",
      codename: "scribe",
      roleLabel: "Scribe",
      objective: "Put the confirmed viewing on the calendar",
      capabilityNames: [TOOL],
      capabilityInputs: {
        [TOOL]: {
          title: "Flat viewing",
          startIso: "2026-09-01T10:00:00.000Z",
          endIso: "2026-09-01T10:45:00.000Z",
        },
      },
    },
    mandateVersion: 1,
    // The real default mandate, not a permissive test one.
    authority: DEFAULT_MISSION_AUTHORITY,
    budgetLimits: {},
    expectedSequence: 0,
    correlationId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

function registryWithWrite(counter: { calls: number }): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(writeAdapter(counter));
  return registry;
}

test("a planned calendar write pauses the node for approval instead of executing", async () => {
  const persistence = new ApprovalGatePersistence();
  const counter = { calls: 0 };
  const result = await runExecuteNode(writeNodeInput(), {
    persistence,
    registry: registryWithWrite(counter),
  });

  assert.equal(result.status, "approval_required");
  assert.equal(counter.calls, 0, "nothing may reach the connected account before an approval");
  const paused = persistence.events.find((event) => event.type === "node.paused");
  assert.equal((paused?.payload as { reason?: string } | undefined)?.reason, "approval_required");
  assert.ok(!result.emittedEventTypes.includes("tool.started"));
  const approval = persistence.approvals[0];
  assert.equal(approval.status, "pending");
  assert.equal(approval.category, "external_write");
});

test("an accepted approval resumes the node and performs the write exactly once", async () => {
  const persistence = new ApprovalGatePersistence();
  const counter = { calls: 0 };
  const paused = await runExecuteNode(writeNodeInput(), {
    persistence,
    registry: registryWithWrite(counter),
  });
  assert.equal(paused.status, "approval_required");

  persistence.settleAll("resolved");
  const resumed = await runExecuteNode(
    writeNodeInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: registryWithWrite(counter) },
  );

  assert.equal(resumed.status, "completed");
  assert.equal(counter.calls, 1, "the approved write runs exactly once");
  assert.equal(
    persistence.events.filter((event) => event.type === "node.paused").length,
    1,
    "the resumed run must not pause on the same approval again",
  );
  assert.equal(
    persistence.events.filter((event) => event.type === "tool.completed").length,
    1,
  );
});

test("a rejected approval fails the node without touching the account", async () => {
  const persistence = new ApprovalGatePersistence();
  const counter = { calls: 0 };
  await runExecuteNode(writeNodeInput(), { persistence, registry: registryWithWrite(counter) });

  persistence.settleAll("rejected");
  const resumed = await runExecuteNode(
    writeNodeInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: registryWithWrite(counter) },
  );

  assert.equal(resumed.status, "failed");
  assert.equal(counter.calls, 0);
});
