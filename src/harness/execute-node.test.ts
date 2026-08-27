import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorityPolicy, BudgetLimits } from "@/core/contracts/types";
import { buildIdempotencyKey } from "../core/idempotency";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  internalFixtureAdapter,
} from "./adapters/internal-fixture";
import { CapabilityRegistry } from "./capability-registry";
import { CapabilityConnectionRequiredError } from "./capability-errors";
import type { CapabilityAdapter, CapabilityExecutionResult } from "./contracts";
import { runExecuteNode, type ExecuteNodeInput } from "./execute-node";
import { InMemoryPersistence } from "./persistence/in-memory-persistence";

function baseAuthority(overrides: Partial<AuthorityPolicy> = {}): AuthorityPolicy {
  return {
    freePassage: true,
    allowedCapabilityIds: [INTERNAL_FIXTURE_CAPABILITY_ID],
    allowedOrigins: [INTERNAL_FIXTURE_ORIGIN],
    allowedTargets: [INTERNAL_FIXTURE_CAPABILITY_ID],
    allowedRiskLevels: ["low", "medium", "high", "critical"],
    maxAutonomousCostMicrounits: 1_000,
    allowExternalSideEffects: true,
    requireApprovalCategories: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExecuteNodeInput> = {}): ExecuteNodeInput {
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
    authority: baseAuthority(),
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

test("happy path: policy allow -> execute -> node.completed, with a stable, replay-safe sequence cursor", async () => {
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();
  const result = await runExecuteNode(baseInput(), { persistence, registry });

  assert.equal(result.status, "completed");
  assert.ok(result.emittedEventTypes.includes("node.started"));
  assert.ok(result.emittedEventTypes.includes("tool.requested"));
  assert.ok(result.emittedEventTypes.includes("tool.started"));
  assert.ok(result.emittedEventTypes.includes("tool.completed"));
  assert.ok(result.emittedEventTypes.includes("evidence.recorded"));
  assert.ok(result.emittedEventTypes.includes("node.completed"));
  assert.ok(!result.emittedEventTypes.includes("policy.denied"));

  const toolEventKeys = persistence.events
    .filter((event) => ["tool.requested", "tool.started", "tool.completed"].includes(event.type))
    .map((event) => event.idempotencyKey);
  assert.equal(new Set(toolEventKeys).size, toolEventKeys.length, "each tool lifecycle event owns a distinct idempotency key");

  // Every event was appended with strictly increasing sequence numbers
  // starting at the input's expectedSequence.
  const sequences = persistence.events.map((event) => event.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(sequences[0], 1);
  assert.equal(result.nextSequence, sequences[sequences.length - 1]);

  // The evidence returned by the walking-skeleton capability is explicitly
  // labeled untrusted, even though the capability descriptor itself is
  // "derived" (see adapters/internal-fixture.ts for the trust-zone design).
  const evidenceEvent = persistence.events.find((event) => event.type === "evidence.recorded");
  assert.equal(evidenceEvent?.trust, "untrusted");
});

test("policy-denial path: capability outside the mandate allowlist stops the node without executing", async () => {
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();
  const result = await runExecuteNode(
    baseInput({ authority: baseAuthority({ allowedCapabilityIds: [] }) }),
    { persistence, registry },
  );

  assert.equal(result.status, "policy_denied");
  assert.ok(result.emittedEventTypes.includes("policy.denied"));
  assert.ok(result.emittedEventTypes.includes("node.failed"));
  assert.ok(!result.emittedEventTypes.includes("tool.started"), "policy must be checked before any execution");
  assert.ok(!result.emittedEventTypes.includes("tool.completed"));
});

test("approval-required path: an untrusted-by-mandate category pauses the node instead of executing", async () => {
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();
  const result = await runExecuteNode(
    baseInput({ authority: baseAuthority({ requireApprovalCategories: ["read"] }) }),
    { persistence, registry },
  );

  assert.equal(result.status, "approval_required");
  assert.ok(result.approvalId);
  assert.ok(result.emittedEventTypes.includes("node.paused"));
  assert.ok(!result.emittedEventTypes.includes("tool.started"));
  assert.equal(persistence.approvals.length, 1);
  assert.equal(persistence.approvals[0].status, "pending");
});

test("budget exhaustion: maxToolCalls stops the node before any tool call, with a visible event", async () => {
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();
  const budgetLimits: BudgetLimits = { maxToolCalls: 0 };
  const result = await runExecuteNode(baseInput({ budgetLimits }), { persistence, registry });

  assert.equal(result.status, "budget_exhausted");
  assert.ok(result.emittedEventTypes.includes("quota.consumed"));
  assert.ok(result.emittedEventTypes.includes("node.failed"));
  assert.ok(!result.emittedEventTypes.includes("tool.started"));
});

test("budget exhaustion: maxWallClockMs stops the node on an injected clock, never looping indefinitely", async () => {
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();
  let calls = 0;
  const now = () => (calls++ === 0 ? 1_000 : 999_999_999); // constructor call, then every check trips
  const budgetLimits: BudgetLimits = { maxWallClockMs: 500 };
  const result = await runExecuteNode(baseInput({ budgetLimits }), { persistence, registry, now });

  assert.equal(result.status, "budget_exhausted");
  const quotaEvent = persistence.events.find((event) => event.type === "quota.consumed");
  assert.equal((quotaEvent?.payload as { kind?: string } | undefined)?.kind, "max_duration");
});

test("maxRetries stops after tolerating exactly N retries beyond the first attempt, then emits tool.failed", async () => {
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  let executeAttempts = 0;
  const failingAdapter: CapabilityAdapter = {
    provider: "test-failing",
    async discover() {
      return [
        {
          id: "test.failing_capability",
          provider: "test-failing",
          name: "test.failing_capability",
          description: "Always fails, used to exercise the retry budget.",
          inputSchema: {},
          risk: { level: "low", categories: ["read"] },
          trust: { level: "derived", origin: INTERNAL_FIXTURE_ORIGIN },
          readOnly: true,
        },
      ];
    },
    async execute(): Promise<CapabilityExecutionResult> {
      executeAttempts += 1;
      throw new Error("simulated failure");
    },
  };
  registry.register(failingAdapter);

  const sleeps: number[] = [];
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Trigger a retry",
        capabilityNames: ["test.failing_capability"],
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["test.failing_capability"],
        allowedTargets: ["test.failing_capability"],
      }),
      budgetLimits: { maxRetries: 1 },
    }),
    { persistence, registry, sleep: async (ms) => void sleeps.push(ms) },
  );

  assert.equal(result.status, "failed");
  assert.equal(executeAttempts, 2, "maxRetries: 1 permits exactly one retry beyond the first attempt");
  assert.equal(sleeps.length, 1, "exactly one backoff sleep between the two attempts");
  assert.ok(result.emittedEventTypes.includes("tool.failed"));
  assert.ok(result.emittedEventTypes.includes("node.failed"));
});

test("a missing OAuth connection pauses once without wasting retry budget", async () => {
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  let executeAttempts = 0;
  const waitingAdapter: CapabilityAdapter = {
    provider: "composio",
    async discover() {
      return [{
        id: "composio.gmail_fetch_emails",
        provider: "composio",
        name: "GMAIL_FETCH_EMAILS",
        description: "Read connected mail",
        inputSchema: {},
        risk: { level: "low", categories: ["read"] },
        trust: { level: "derived", origin: "https://composio.dev" },
        readOnly: true,
      }];
    },
    async execute(): Promise<CapabilityExecutionResult> {
      executeAttempts += 1;
      throw new CapabilityConnectionRequiredError("composio", "gmail");
    },
  };
  registry.register(waitingAdapter);

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Read authorized relocation mail",
        capabilityNames: ["GMAIL_FETCH_EMAILS"],
        capabilityInputs: { GMAIL_FETCH_EMAILS: { query: "relocation" } },
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["composio.gmail_fetch_emails"],
        allowedOrigins: ["https://composio.dev"],
        allowedTargets: ["composio.gmail_fetch_emails"],
      }),
    }),
    { persistence, registry, sleep: async () => undefined },
  );

  assert.equal(result.status, "waiting_for_connection");
  assert.equal(executeAttempts, 1);
  const paused = persistence.events.find((event) => event.type === "node.paused");
  assert.equal((paused?.payload as { toolkit?: string }).toolkit, "gmail");
});

test("idempotency key stability: identical mission/node/capability/mandate/request always derives the same key", () => {
  const keyInput = {
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    mandateVersion: 1,
    request: { topic: "Research relocation fixtures" },
  };
  const first = buildIdempotencyKey(keyInput);
  const second = buildIdempotencyKey(keyInput);
  assert.equal(first, second);

  const differentMandate = buildIdempotencyKey({ ...keyInput, mandateVersion: 2 });
  assert.notEqual(first, differentMandate);
});

test("idempotency key stability: two runs of the same node produce identical tool.requested keys", async () => {
  const persistenceA = new InMemoryPersistence();
  const persistenceB = new InMemoryPersistence();
  await runExecuteNode(baseInput(), { persistence: persistenceA, registry: registryWithFixture() });
  await runExecuteNode(baseInput(), { persistence: persistenceB, registry: registryWithFixture() });

  const keyA = persistenceA.events.find((event) => event.type === "tool.requested")?.idempotencyKey;
  const keyB = persistenceB.events.find((event) => event.type === "tool.requested")?.idempotencyKey;
  assert.ok(keyA);
  assert.equal(keyA, keyB);
});
