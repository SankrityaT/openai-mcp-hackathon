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
import { InternalFixtureAdapter } from "./adapters/internal-fixture";
import { CapabilityConnectionRequiredError } from "./capability-errors";
import type { CapabilityAdapter, CapabilityExecutionResult, HarnessPersistencePort } from "./contracts";
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

test("approval-required path is byte-identical when the reach-me notifier is unconfigured", async () => {
  // The notify dispatch added to this branch is fire and forget: with Inngest
  // unconfigured it must resolve to a typed no-op, touch no network, and
  // change nothing about what the branch persists or returns. Any regression
  // that lets it reach out, throw, or reorder the pause fails here.
  delete process.env.INNGEST_EVENT_KEY;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("the pause path must never make a network call");
  }) as typeof globalThis.fetch;

  try {
    const persistence = new InMemoryPersistence();
    const registry = registryWithFixture();
    const result = await runExecuteNode(
      baseInput({ authority: baseAuthority({ requireApprovalCategories: ["read"] }) }),
      { persistence, registry },
    );

    assert.equal(result.status, "approval_required");
    assert.ok(result.approvalId);
    assert.deepEqual(result.emittedEventTypes, [
      "node.started",
      "capability.discovered",
      "tool.requested",
      "node.paused",
    ]);
    assert.equal(persistence.approvals.length, 1);
    assert.equal(persistence.approvals[0].status, "pending");
    assert.ok(!result.emittedEventTypes.includes("tool.started"));
  } finally {
    globalThis.fetch = originalFetch;
  }
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

// --- wallet budget enforcement ------------------------------------------------
//
// The mandate's `maxCostMicrounits` is the micro-USD the user's context wallet
// passes actually loaded. A node that would commit money reserves its estimate
// against that ceiling through `consume_usage` before it touches a capability,
// so the database, not this process, decides whether the step may proceed.

/** Every `mission_cost` reservation the run attempted against persistence. */
function costReservations(persistence: InMemoryPersistence) {
  return persistence.usageRecords.filter((record) => record.metric === "mission_cost");
}

/**
 * Free Passage's `maxAutonomousCostMicrounits` is a ceiling separate from the
 * wallet: it decides whether a priced step may run without asking, while the
 * wallet decides whether the money is there at all. The tests below are about
 * the wallet, so the mandate authorizes these amounts autonomously; the
 * interaction between the two ceilings has its own test at the end.
 */
function walletAuthority(): AuthorityPolicy {
  return baseAuthority({ maxAutonomousCostMicrounits: 1_000_000 });
}

test("a node that commits nothing reserves nothing and runs unchanged", async () => {
  const persistence = new InMemoryPersistence();
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Research relocation fixtures",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 0,
      },
      budgetLimits: { maxCostMicrounits: 5_000_000 },
    }),
    { persistence, registry: registryWithFixture() },
  );

  assert.equal(result.status, "completed");
  assert.equal(costReservations(persistence).length, 0, "a research step must never touch the wallet");
  assert.ok(!result.emittedEventTypes.includes("quota.consumed"));
});

test("an estimate inside the loaded budget is reserved, announced, and allowed through", async () => {
  const persistence = new InMemoryPersistence();
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Place the holding deposit",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 200_000,
      },
      authority: walletAuthority(),
      budgetLimits: { maxCostMicrounits: 1_000_000 },
    }),
    { persistence, registry: registryWithFixture() },
  );

  assert.equal(result.status, "completed");
  const reservations = costReservations(persistence);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].costMicrounits, 200_000);
  assert.equal(reservations[0].quantity, 0);
  assert.equal(reservations[0].limitCostMicrounits, 1_000_000);
  assert.equal(reservations[0].subjectKind, "mission");
  assert.equal(reservations[0].subjectId, "mission-1");
  assert.equal(reservations[0].idempotencyKey, "cost:mission-1:node-1:v1");

  const quotaEvent = persistence.events.find((event) => event.type === "quota.consumed");
  assert.deepEqual(quotaEvent?.payload, {
    kind: "cost",
    used: 200_000,
    limit: 1_000_000,
    exhausted: false,
  });
  // The reservation is announced before the node reaches any capability.
  const quotaIndex = persistence.events.findIndex((event) => event.type === "quota.consumed");
  const requestedIndex = persistence.events.findIndex((event) => event.type === "tool.requested");
  assert.ok(quotaIndex >= 0 && quotaIndex < requestedIndex);
});

test("a second node on the same mission gates against the first node's committed spend", async () => {
  // One mission is one usage window, so the running total the database reports
  // back is what the ceiling and the policy engine both judge against.
  const persistence = new InMemoryPersistence();
  await runExecuteNode(
    baseInput({
      nodeId: "node-1",
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Place the first deposit",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 300_000,
      },
      authority: walletAuthority(),
      budgetLimits: { maxCostMicrounits: 1_000_000 },
    }),
    { persistence, registry: registryWithFixture() },
  );

  const result = await runExecuteNode(
    baseInput({
      nodeId: "node-2",
      expectedSequence: persistence.events[persistence.events.length - 1].sequence,
      node: {
        clientId: "node-2",
        codename: "courier",
        roleLabel: "Courier",
        objective: "Place the second deposit",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 400_000,
      },
      authority: walletAuthority(),
      budgetLimits: { maxCostMicrounits: 1_000_000 },
    }),
    { persistence, registry: registryWithFixture() },
  );

  assert.equal(result.status, "completed");
  const quotaEvents = persistence.events.filter((event) => event.type === "quota.consumed");
  assert.equal(quotaEvents.length, 2);
  assert.deepEqual(quotaEvents[1].payload, {
    kind: "cost",
    used: 700_000,
    limit: 1_000_000,
    exhausted: false,
  });
});

test("an estimate past the loaded budget fails the node before any capability runs", async () => {
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  let executeAttempts = 0;
  registry.register({
    provider: internalFixtureAdapter.provider,
    discover: () => internalFixtureAdapter.discover(),
    execute: (request) => {
      executeAttempts += 1;
      return internalFixtureAdapter.execute(request);
    },
  });

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "courier",
        roleLabel: "Courier",
        objective: "Place a deposit larger than the wallet holds",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 2_000_000,
      },
      budgetLimits: { maxCostMicrounits: 1_000_000 },
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "budget_exhausted");
  assert.equal(executeAttempts, 0, "nothing may execute once the budget refuses the step");
  assert.deepEqual(result.emittedEventTypes, ["node.started", "quota.consumed", "node.failed"]);

  const quotaEvent = persistence.events.find((event) => event.type === "quota.consumed");
  assert.deepEqual(quotaEvent?.payload, {
    kind: "cost",
    used: 2_000_000,
    limit: 1_000_000,
    exhausted: true,
  });
  const failed = persistence.events.find((event) => event.type === "node.failed");
  assert.deepEqual(failed?.payload, { nodeId: "node-1", reason: "budget_exhausted", kind: "cost" });
});

test("an absent cost ceiling means nothing was loaded, so any spend is refused", async () => {
  const persistence = new InMemoryPersistence();
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "courier",
        roleLabel: "Courier",
        objective: "Pay a booking fee",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 1,
      },
      budgetLimits: {},
    }),
    { persistence, registry: registryWithFixture() },
  );

  assert.equal(result.status, "budget_exhausted");
  const quotaEvent = persistence.events.find((event) => event.type === "quota.consumed");
  assert.deepEqual(quotaEvent?.payload, { kind: "cost", used: 1, limit: 0, exhausted: true });
});

test("re-running the same node replays its reservation instead of reserving twice", async () => {
  // A retried Inngest step or an approval resume re-enters this node under the
  // same mandate version, so the reservation key is identical and the database
  // replays it. One step is only ever committed once.
  const persistence = new InMemoryPersistence();
  const node = {
    clientId: "node-1",
    codename: "courier",
    roleLabel: "Courier",
    objective: "Place the holding deposit",
    capabilityNames: ["internal.echo_research"],
    estimatedCostMicrounits: 600_000,
  };
  const budgetLimits: BudgetLimits = { maxCostMicrounits: 1_000_000 };

  const first = await runExecuteNode(baseInput({ node, budgetLimits, authority: walletAuthority() }), {
    persistence,
    registry: registryWithFixture(),
  });
  assert.equal(first.status, "completed");

  const second = await runExecuteNode(
    baseInput({
      node,
      budgetLimits,
      authority: walletAuthority(),
      expectedSequence: persistence.events[persistence.events.length - 1].sequence,
    }),
    { persistence, registry: registryWithFixture() },
  );

  // Twice 600_000 would exceed the 1_000_000 ceiling; the replay does not.
  assert.equal(second.status, "completed");
  const quotaEvents = persistence.events.filter((event) => event.type === "quota.consumed");
  assert.equal(quotaEvents.length, 2);
  assert.deepEqual(quotaEvents[0].payload, quotaEvents[1].payload);
  assert.deepEqual(quotaEvents[1].payload, {
    kind: "cost",
    used: 600_000,
    limit: 1_000_000,
    exhausted: false,
  });
});

test("a persistence failure that is not a budget refusal propagates unchanged", async () => {
  const persistence = new InMemoryPersistence();
  const broken: HarnessPersistencePort = {
    appendEvent: (command) => persistence.appendEvent(command),
    listEvents: (missionId) => persistence.listEvents(missionId),
    requestApproval: (command) => persistence.requestApproval(command),
    reserveIdempotency: (reserve) => persistence.reserveIdempotency(reserve),
    completeIdempotency: (complete) => persistence.completeIdempotency(complete),
    recordUsage: async () => {
      throw new Error("transport failure");
    },
  };

  await assert.rejects(
    () =>
      runExecuteNode(
        baseInput({
          node: {
            clientId: "node-1",
            codename: "courier",
            roleLabel: "Courier",
            objective: "Place the holding deposit",
            capabilityNames: ["internal.echo_research"],
            estimatedCostMicrounits: 10,
          },
          budgetLimits: { maxCostMicrounits: 1_000_000 },
        }),
        { persistence: broken, registry: registryWithFixture() },
      ),
    /transport failure/,
  );
});

test("money the wallet holds but the mandate will not spend autonomously stops for approval", async () => {
  // The two ceilings answer different questions. The wallet reserves the
  // estimate happily — the money is loaded — and the mandate then declines to
  // commit it without the person, so the node pauses instead of executing.
  const persistence = new InMemoryPersistence();
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "courier",
        roleLabel: "Courier",
        objective: "Place the holding deposit",
        capabilityNames: ["internal.echo_research"],
        estimatedCostMicrounits: 200_000,
      },
      authority: baseAuthority({ maxAutonomousCostMicrounits: 1_000 }),
      budgetLimits: { maxCostMicrounits: 1_000_000 },
    }),
    { persistence, registry: registryWithFixture() },
  );

  assert.equal(result.status, "approval_required");
  assert.ok(!result.emittedEventTypes.includes("tool.started"));
  // The reservation still happened and is still reported truthfully: the money
  // is spoken for while the approval is outstanding, and the resumed run
  // replays the same key rather than reserving it a second time.
  assert.equal(costReservations(persistence).length, 1);
  const quotaEvent = persistence.events.find((event) => event.type === "quota.consumed");
  assert.deepEqual(quotaEvent?.payload, {
    kind: "cost",
    used: 200_000,
    limit: 1_000_000,
    exhausted: false,
  });
});

test("the internal worker receives upstream evidence from prerequisite nodes", async () => {
  const persistence = new InMemoryPersistence();
  const upstreamNodeId = "11111111-1111-1111-1111-111111111111";
  await persistence.appendEvent({
    missionId: "mission-up",
    nodeId: upstreamNodeId,
    expectedSequence: 0,
    type: "tool.completed",
    actor: { kind: "cardea", id: "test" },
    correlationId: "22222222-2222-2222-2222-222222222222",
    payload: {
      capabilityId: "composio.gmail_fetch_emails",
      summary: "Fetched 12 messages",
      output: { excerpt: "Netflix $15.49 monthly. Spotify $11.99 monthly." },
    },
    trust: "untrusted",
  });

  const seenTopics: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    new InternalFixtureAdapter(async (topic) => {
      seenTopics.push(topic);
      return "Consolidated subscription summary";
    }),
  );

  const result = await runExecuteNode(
    baseInput({
      missionId: "mission-up",
      nodeId: "33333333-3333-3333-3333-333333333333",
      node: {
        clientId: "consolidator",
        codename: "Lyra",
        roleLabel: "Consolidator",
        objective: "Summarize the subscriptions found upstream.",
        capabilityNames: ["internal.echo_research"],
        dependsOnNodeIds: [upstreamNodeId],
      },
      expectedSequence: 1,
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "completed");
  assert.equal(seenTopics.length, 1);
  assert.match(seenTopics[0], /Summarize the subscriptions/);
  assert.match(seenTopics[0], /Upstream evidence recorded by earlier steps/);
  assert.match(seenTopics[0], /Netflix \$15\.49/);
});
