import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorityPolicy, BudgetLimits, JsonValue, MissionApproval, MissionEvent } from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import { buildIdempotencyKey } from "../core/idempotency";
import { ASK_USER_CAPABILITY_ID, ASK_USER_ORIGIN, askUserAdapter } from "./adapters/ask-user";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  internalFixtureAdapter,
} from "./adapters/internal-fixture";
import { CapabilityRegistry } from "./capability-registry";
import { InternalFixtureAdapter } from "./adapters/internal-fixture";
import { CapabilityConnectionRequiredError } from "./capability-errors";
import type { CapabilityAdapter, CapabilityExecutionResult, HarnessPersistencePort } from "./contracts";
import {
  BROWSER_SESSION_DAILY_LIMIT,
  missionFailureOnFailureIdempotencyKey,
  missionFailureOnFailurePayload,
  nodeFailureOnFailureIdempotencyKey,
  nodeFailureOnFailurePayload,
  onFailureRunToken,
  runExecuteNode,
  type ExecuteNodeInput,
} from "./execute-node";
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

test("planner-supplied worker input gets upstream evidence appended, not replaced", async () => {
  const persistence = new InMemoryPersistence();
  const upstreamNodeId = "55555555-5555-5555-5555-555555555555";
  await persistence.appendEvent({
    missionId: "mission-up2",
    nodeId: upstreamNodeId,
    expectedSequence: 0,
    type: "tool.completed",
    actor: { kind: "cardea", id: "test" },
    correlationId: "66666666-6666-6666-6666-666666666666",
    payload: {
      capabilityId: "cardea.web_lookup",
      summary: "Read \"Hacker News\" at news.ycombinator.com",
      output: { excerpt: "1. Story about DNS caching. 2. Story about medicine." },
    },
    trust: "untrusted",
  });

  const seenTopics: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    new InternalFixtureAdapter(async (topic) => {
      seenTopics.push(topic);
      return "Digest";
    }),
  );

  const result = await runExecuteNode(
    baseInput({
      missionId: "mission-up2",
      nodeId: "77777777-7777-7777-7777-777777777777",
      node: {
        clientId: "digest",
        codename: "Oberon",
        roleLabel: "Digest writer",
        objective: "Write the digest.",
        capabilityNames: ["internal.echo_research"],
        capabilityInputs: { "internal.echo_research": "Write a three line digest of the top stories." },
        dependsOnNodeIds: [upstreamNodeId],
      },
      expectedSequence: 1,
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "completed");
  assert.match(seenTopics[0], /three line digest/);
  assert.match(seenTopics[0], /Upstream evidence recorded by earlier steps/);
  assert.match(seenTopics[0], /DNS caching/);
});

test("a browser launch past the tenant's daily allowance stops the node, not the card", async () => {
  const persistence = new InMemoryPersistence();
  // The whole allowance already drawn today: the next launch must be refused.
  // Seeded from the constant so raising the allowance cannot silently turn
  // this into a test of nothing.
  for (let i = 0; i < BROWSER_SESSION_DAILY_LIMIT; i += 1) {
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await persistence.recordUsage({
      tenantId: "tenant-1",
      missionId: "mission-1",
      nodeId: `node-seed-${i}`,
      subjectKind: "provider",
      subjectId: "cloudflare-browser",
      metric: "browser_session",
      quantity: 1,
      costMicrounits: 0,
      limitQuantity: BROWSER_SESSION_DAILY_LIMIT,
      limitCostMicrounits: Number.MAX_SAFE_INTEGER,
      windowStart: dayStart.toISOString(),
      windowEnd: new Date(dayStart.getTime() + 86_400_000).toISOString(),
      idempotencyKey: `seed-${i}`,
      correlationId: "99999999-9999-9999-9999-999999999999",
    });
  }

  const registry = new CapabilityRegistry();
  let executed = 0;
  registry.register({
    provider: "cardea",
    async discover() {
      return [
        {
          id: "cardea.web_lookup",
          provider: "cardea",
          name: "cardea.web_lookup",
          description: "test browse",
          inputSchema: { type: "object" },
          risk: { level: "low" as const, categories: ["read"] },
          trust: { level: "derived" as const, origin: "https://browser.cardea.local", provenance: "t" },
          readOnly: true,
        },
      ];
    },
    async execute() {
      executed += 1;
      return {
        executionId: "x",
        output: {},
        summary: "read",
        provenance: "t",
        trust: "untrusted" as const,
      };
    },
  });

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "browse",
        codename: "Vega",
        roleLabel: "Web researcher",
        objective: "Browse",
        capabilityNames: ["cardea.web_lookup"],
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["cardea.web_lookup"],
        allowedTargets: ["cardea.web_lookup"],
        allowedOrigins: ["https://browser.cardea.local"],
      }),
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "budget_exhausted");
  assert.equal(executed, 0, "no session may open past the allowance");
  assert.ok(result.emittedEventTypes.includes("node.failed"));

  // The allowance resets at the next day window, so the reservation this
  // attempt never spent must be released. Left `reserved`, it would deny every
  // future run of this node `idempotency_in_progress` forever. Re-reserving
  // the same key reports the state a later run would find.
  const key = buildIdempotencyKey({
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: "cardea.web_lookup",
    action: "cardea.web_lookup",
    mandateVersion: 1,
    request: { topic: "Browse" },
  });
  const replayed = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: "cardea.web_lookup",
    action: "cardea.web_lookup",
    key,
    requestFingerprint: key,
  });
  assert.equal(replayed.state, "failed_retryable", "a denied launch must not wedge the node");
});

test("web research results flow into the consolidator as page excerpts", async () => {
  const persistence = new InMemoryPersistence();
  const upstreamNodeId = "88888888-8888-8888-8888-888888888888";
  await persistence.appendEvent({
    missionId: "mission-up3",
    nodeId: upstreamNodeId,
    expectedSequence: 0,
    type: "tool.completed",
    actor: { kind: "cardea", id: "test" },
    correlationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    payload: {
      capabilityId: "cardea.web_research",
      summary: 'Searched "flowers phoenix" and read 2 of 2 results: a.com, b.com',
      output: {
        query: "flowers phoenix",
        results: [
          { url: "https://a.com/x", title: "Best Florists", excerpt: "Desert Rose Florist, bouquets from $45." },
          { url: "https://b.com/y", error: "unreadable" },
        ],
      },
    },
    trust: "untrusted",
  });

  const seenTopics: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    new InternalFixtureAdapter(async (topic) => {
      seenTopics.push(topic);
      return "Brief";
    }),
  );

  const result = await runExecuteNode(
    baseInput({
      missionId: "mission-up3",
      nodeId: "99999999-9999-9999-9999-999999999999",
      node: {
        clientId: "brief",
        codename: "Orion",
        roleLabel: "Brief writer",
        objective: "Write the buying brief.",
        capabilityNames: ["internal.echo_research"],
        dependsOnNodeIds: [upstreamNodeId],
      },
      expectedSequence: 1,
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "completed");
  assert.match(seenTopics[0], /Desert Rose Florist, bouquets from \$45/);
  assert.match(seenTopics[0], /Best Florists/);
});

// --- retry/replay contract against the live RPC semantics ---------------------
//
// `append_mission_event` replays an idempotency key only when event type and
// payload are identical (else 23505), and `complete_idempotency` refuses
// missing or terminal rows (55000). InMemoryPersistence models both, so these
// tests fail against any run that re-executes a completed write, appends a
// mismatched replay payload, or re-completes a succeeded reservation.

test("a bookkeeping failure after a successful write propagates without re-executing, and redelivery replays it byte-identically", async () => {
  const persistence = new InMemoryPersistence();
  let failNextEvidence = true;
  const flaky: HarnessPersistencePort = {
    appendEvent: async (command) => {
      if (command.type === "evidence.recorded" && failNextEvidence) {
        failNextEvidence = false;
        throw new Error("transient append failure");
      }
      return persistence.appendEvent(command);
    },
    listEvents: (missionId) => persistence.listEvents(missionId),
    requestApproval: (command) => persistence.requestApproval(command),
    reserveIdempotency: (reserve) => persistence.reserveIdempotency(reserve),
    completeIdempotency: (complete) => persistence.completeIdempotency(complete),
    recordUsage: (usage) => persistence.recordUsage(usage),
  };

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

  await assert.rejects(
    () => runExecuteNode(baseInput(), { persistence: flaky, registry }),
    /transient append failure/,
  );
  assert.equal(executeAttempts, 1, "the write already reached the provider; bookkeeping must never run it again");

  const redelivered = await runExecuteNode(
    baseInput({ expectedSequence: persistence.events[persistence.events.length - 1].sequence }),
    { persistence: flaky, registry },
  );

  assert.equal(redelivered.status, "completed");
  assert.equal(executeAttempts, 1, "redelivery replays the stored result instead of executing again");
  const completions = persistence.events.filter((event) => event.type === "tool.completed");
  assert.equal(completions.length, 1);
  const payload = completions[0].payload as {
    summary?: string;
    provenance?: string;
    output?: JsonValue;
    replayed?: boolean;
  };
  assert.equal(payload.replayed, undefined, "the replay must carry the original payload, not a variant");
  assert.ok(typeof payload.summary === "string");
  assert.ok(typeof payload.provenance === "string");
  assert.ok(payload.output !== undefined);
});

test("a stored result that predates the completion shape is replayed honestly under its own key", async () => {
  // A reservation written before the StoredToolCompletion envelope existed
  // holds the bare output, so the original payload cannot be rebuilt and the
  // original key cannot be reused. It must still reach the log: skipping the
  // append let the node complete with no tool.completed at all, which left
  // every dependent's evidence empty. The distinct `:replayed` key is what
  // keeps this from ever conflicting with what the first run committed.
  const persistence = new InMemoryPersistence();
  const key = buildIdempotencyKey({
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    mandateVersion: 1,
    request: { topic: "Research relocation fixtures" },
  });
  await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    key,
    requestFingerprint: key,
  });
  await persistence.completeIdempotency({
    tenantId: "tenant-1",
    key,
    outcome: "succeeded",
    result: { finding: "recorded by an older run, bare output only" },
  });

  const result = await runExecuteNode(baseInput(), { persistence, registry: registryWithFixture() });

  assert.equal(result.status, "completed");
  assert.ok(!result.emittedEventTypes.includes("tool.started"), "nothing may execute on a replay");
  const completions = persistence.events.filter((event) => event.type === "tool.completed");
  assert.equal(completions.length, 1);
  const payload = completions[0].payload as {
    output?: JsonValue;
    summary?: string;
    provenance?: string;
    replayed?: boolean;
  };
  assert.deepEqual(payload.output, { finding: "recorded by an older run, bare output only" });
  assert.equal(payload.replayed, true, "the event must not claim this run produced it");
  assert.equal(payload.provenance, "replayed-reservation");
  assert.match(String(payload.summary), /Replayed the stored result/);
  assert.equal(completions[0].trust, "untrusted");
  assert.ok(
    completions[0].idempotencyKey?.endsWith(":replayed"),
    "a distinct key so it can never conflict with the original append",
  );
});

test("a pre-envelope replay still feeds a dependent's upstream evidence", async () => {
  // The consequence the skipped append actually had: consolidation read
  // nothing from the replayed node and wrote an empty brief.
  const persistence = new InMemoryPersistence();
  const upstreamNodeId = "node-1";
  const key = buildIdempotencyKey({
    missionId: "mission-1",
    nodeId: upstreamNodeId,
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    mandateVersion: 1,
    request: { topic: "Research relocation fixtures" },
  });
  await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: upstreamNodeId,
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    key,
    requestFingerprint: key,
  });
  await persistence.completeIdempotency({
    tenantId: "tenant-1",
    key,
    outcome: "succeeded",
    result: { finding: "Desert Rose Florist, bouquets from $45." },
  });

  const upstream = await runExecuteNode(baseInput(), { persistence, registry: registryWithFixture() });
  assert.equal(upstream.status, "completed");

  const seenTopics: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    new InternalFixtureAdapter(async (topic) => {
      seenTopics.push(topic);
      return "Brief";
    }),
  );
  const downstream = await runExecuteNode(
    baseInput({
      nodeId: "node-2",
      expectedSequence: persistence.events[persistence.events.length - 1].sequence,
      node: {
        clientId: "node-2",
        codename: "Lyra",
        roleLabel: "Consolidator",
        objective: "Write the buying brief.",
        capabilityNames: ["internal.echo_research"],
        dependsOnNodeIds: [upstreamNodeId],
      },
    }),
    { persistence, registry },
  );

  assert.equal(downstream.status, "completed");
  assert.match(seenTopics[0], /Upstream evidence recorded by earlier steps/);
  assert.match(seenTopics[0], /Desert Rose Florist, bouquets from \$45/);
});

/**
 * The same two SQL-layer behaviors `approval-resume.test.ts` documents:
 * `request_mission_approval` returns an existing approval without appending a
 * second request event, plus a one-shot injected append failure to leave a
 * run partially committed.
 */
class RedeliveredAskPersistence extends InMemoryPersistence {
  private readonly approvalsByRequestKey = new Map<string, MissionApproval>();
  failNextToolCompleted = false;

  override async appendEvent(command: AppendMissionEventCommand): Promise<MissionEvent> {
    if (command.type === "tool.completed" && this.failNextToolCompleted) {
      this.failNextToolCompleted = false;
      throw new Error("transient append failure");
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

  settleAll(resolution: JsonValue): void {
    for (const approval of this.approvalsByRequestKey.values()) {
      approval.status = "resolved";
      approval.resolvedAt = new Date().toISOString();
      approval.resolution = resolution;
    }
  }

  lastSequence(): number {
    return this.events.length === 0 ? 0 : this.events[this.events.length - 1].sequence;
  }
}

test("a redelivered ask-user run whose answer is already recorded completes without re-completing the reservation", async () => {
  const persistence = new RedeliveredAskPersistence();
  const registry = new CapabilityRegistry();
  registry.register(askUserAdapter);
  const question = {
    question: "which style do you want?",
    options: ["walnut mid-century", "white minimal"],
    recommended: "white minimal",
  };
  const input = (expectedSequence: number): ExecuteNodeInput =>
    baseInput({
      expectedSequence,
      node: {
        clientId: "ask",
        codename: "vega",
        roleLabel: "Concierge",
        objective: "Ask which style the person wants",
        capabilityNames: [ASK_USER_CAPABILITY_ID],
        capabilityInputs: { [ASK_USER_CAPABILITY_ID]: JSON.stringify(question) },
      },
      authority: baseAuthority({
        allowedCapabilityIds: [ASK_USER_CAPABILITY_ID],
        allowedOrigins: [ASK_USER_ORIGIN],
        allowedTargets: [ASK_USER_CAPABILITY_ID],
      }),
    });

  const paused = await runExecuteNode(input(0), { persistence, registry });
  assert.equal(paused.status, "approval_required");
  persistence.settleAll({ note: "walnut mid-century" });

  // The resume records the answer as succeeded, then crashes before its
  // tool.completed append commits: the exact partial-bookkeeping state a
  // redelivered run finds.
  persistence.failNextToolCompleted = true;
  await assert.rejects(
    () => runExecuteNode(input(persistence.lastSequence()), { persistence, registry }),
    /transient append failure/,
  );

  const redelivered = await runExecuteNode(input(persistence.lastSequence()), { persistence, registry });

  assert.equal(redelivered.status, "completed");
  const completions = persistence.events.filter((event) => event.type === "tool.completed");
  assert.equal(completions.length, 1);
  assert.deepEqual((completions[0].payload as { output?: JsonValue }).output, {
    question: "which style do you want?",
    answer: "walnut mid-century",
  });
  assert.equal((completions[0].payload as { summary?: string }).summary, "answered: walnut mid-century");
  assert.equal(persistence.events.filter((event) => event.type === "approval.requested").length, 1);
  assert.equal(persistence.events.filter((event) => event.type === "node.paused").length, 1);
});

// --- terminal materialization across runs -------------------------------------
//
// `cardea-execute-node` runs more than once per node: `resumeApprovedNode`
// re-invokes it after an approval settles. `append_mission_event` short-
// circuits a matching (key, type, payload) into a replay of the committed
// event WITHOUT running its `p_node_status` block, so an `onFailure` key
// constant across runs left the board stuck on whatever the second run had
// materialized. InMemoryPersistence models the status column, so these tests
// see the stuck board that the event log alone cannot show.

/**
 * The append `cardea-execute-node`'s `onFailure` handler makes, and nothing
 * else. The handler itself cannot be loaded under plain `node --test`
 * (inngest/functions.ts is a server-only module with aliased value imports),
 * so the key and payload pair it commits is exercised directly here against
 * the same persistence double the handler talks to in production.
 */
async function appendOnFailure(
  persistence: InMemoryPersistence,
  missionId: string,
  nodeId: string,
  runToken: string,
): Promise<void> {
  await persistence.appendEvent({
    missionId,
    nodeId,
    expectedSequence: persistence.events[persistence.events.length - 1]?.sequence ?? 0,
    type: "node.failed",
    actor: { kind: "system", id: "mission-harness" },
    correlationId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: nodeFailureOnFailureIdempotencyKey(missionId, nodeId, runToken),
    payload: nodeFailureOnFailurePayload(nodeId, runToken),
    trust: "derived",
    materialization: { nodeStatus: "failed" },
  });
}

async function appendNodeStarted(persistence: InMemoryPersistence, nodeId: string): Promise<void> {
  await persistence.appendEvent({
    missionId: "mission-1",
    nodeId,
    expectedSequence: persistence.events[persistence.events.length - 1]?.sequence ?? 0,
    type: "node.started",
    actor: { kind: "cardea", id: "mission-harness" },
    correlationId: "11111111-1111-1111-1111-111111111111",
    payload: { nodeId },
    trust: "derived",
    materialization: { nodeStatus: "running" },
  });
}

test("a second exhausted run of the same node still materializes failed", async () => {
  const persistence = new InMemoryPersistence();

  await appendNodeStarted(persistence, "node-1");
  await appendOnFailure(persistence, "mission-1", "node-1", "run-a");
  assert.equal(persistence.nodeStatuses.get("node-1"), "failed");

  // The person resolves an approval and the node is dispatched again.
  await appendNodeStarted(persistence, "node-1");
  assert.equal(persistence.nodeStatuses.get("node-1"), "running");

  // The second run exhausts its retries too. Under a key constant across runs
  // this replays run one's event, skips the materialization, and leaves the
  // board reading "running" forever.
  await appendOnFailure(persistence, "mission-1", "node-1", "run-b");
  assert.equal(persistence.nodeStatuses.get("node-1"), "failed");
  assert.equal(persistence.events.filter((event) => event.type === "node.failed").length, 2);
});

test("a redelivery of the same failed run replays instead of appending twice", async () => {
  const persistence = new InMemoryPersistence();
  await appendNodeStarted(persistence, "node-1");
  await appendOnFailure(persistence, "mission-1", "node-1", "run-a");
  await appendOnFailure(persistence, "mission-1", "node-1", "run-a");

  assert.equal(persistence.events.filter((event) => event.type === "node.failed").length, 1);
  assert.equal(persistence.nodeStatuses.get("node-1"), "failed");
});

test("the onFailure key and payload move together, so a key match always implies an identical payload", () => {
  const keyA = nodeFailureOnFailureIdempotencyKey("mission-1", "node-1", "run-a");
  const keyB = nodeFailureOnFailureIdempotencyKey("mission-1", "node-1", "run-b");
  assert.notEqual(keyA, keyB, "different runs must not share a key");
  assert.notDeepEqual(
    nodeFailureOnFailurePayload("node-1", "run-a"),
    nodeFailureOnFailurePayload("node-1", "run-b"),
    "and must not share a payload either, or the replay would 23505",
  );
  assert.ok(keyA.length <= 200);

  const missionA = missionFailureOnFailureIdempotencyKey("mission-1", "run-a");
  assert.notEqual(missionA, missionFailureOnFailureIdempotencyKey("mission-1", "run-b"));
  assert.notDeepEqual(
    missionFailureOnFailurePayload("run-a"),
    missionFailureOnFailurePayload("run-b"),
  );
  assert.ok(missionA.length <= 200);
});

test("the run token prefers Inngest's run id and falls back to the dispatch sequence", () => {
  assert.equal(onFailureRunToken("01JABCDEF", 7), "01JABCDEF");
  // A transport that omits run_id still discriminates: the original dispatch
  // and the resume that re-invoked the function carry different sequences.
  assert.equal(onFailureRunToken(undefined, 7), "seq-7");
  assert.equal(onFailureRunToken("", 9), "seq-9");
  assert.notEqual(onFailureRunToken(undefined, 7), onFailureRunToken(undefined, 12));
  assert.equal(onFailureRunToken("x".repeat(200), 1).length, 64, "the token stays inside the key bound");
});

// --- reservations are an execution guard, never a wedge -----------------------

test("a fault completing the reservation after a successful write does not fail the node", async () => {
  const persistence = new InMemoryPersistence();
  let failNextComplete = true;
  const flaky: HarnessPersistencePort = {
    appendEvent: (command) => persistence.appendEvent(command),
    listEvents: (missionId) => persistence.listEvents(missionId),
    requestApproval: (command) => persistence.requestApproval(command),
    reserveIdempotency: (reserve) => persistence.reserveIdempotency(reserve),
    completeIdempotency: async (complete) => {
      if (complete.outcome === "succeeded" && failNextComplete) {
        failNextComplete = false;
        throw new Error("transient complete_idempotency failure");
      }
      return persistence.completeIdempotency(complete);
    },
    recordUsage: (usage) => persistence.recordUsage(usage),
  };

  const breadcrumbs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void breadcrumbs.push(args);
  let result;
  try {
    result = await runExecuteNode(baseInput(), { persistence: flaky, registry: registryWithFixture() });
  } finally {
    console.error = originalError;
  }

  // The provider-side write landed. Failing here would make the node terminal
  // for a bookkeeping fault, and leave the row `reserved` with nothing left to
  // release it, so every later run would be denied `idempotency_in_progress`.
  assert.equal(result.status, "completed");
  assert.ok(result.emittedEventTypes.includes("tool.completed"));
  assert.ok(result.emittedEventTypes.includes("evidence.recorded"));
  assert.ok(result.emittedEventTypes.includes("node.completed"));
  assert.equal(breadcrumbs.length, 1, "the fault is recorded, not swallowed silently");
  const line = breadcrumbs[0].map(String).join(" ");
  assert.match(line, /complete-idempotency-succeeded/);
  assert.ok(!line.includes("Research relocation fixtures"), "the breadcrumb carries no payload");
});

test("a takeover-required decision releases its reservation instead of wedging the node", async () => {
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  let executed = 0;
  registry.register({
    provider: "test-signing",
    async discover() {
      return [
        {
          id: "test.sign_lease",
          provider: "test-signing",
          name: "test.sign_lease",
          description: "Signs a lease the person must sign themselves.",
          inputSchema: {},
          risk: { level: "low" as const, categories: ["legal_agreement_or_signature"] },
          trust: { level: "derived" as const, origin: INTERNAL_FIXTURE_ORIGIN },
          readOnly: false,
        },
      ];
    },
    async execute(): Promise<CapabilityExecutionResult> {
      executed += 1;
      throw new Error("a takeover-required action must never execute");
    },
  });

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Sign the lease",
        capabilityNames: ["test.sign_lease"],
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["test.sign_lease"],
        allowedTargets: ["test.sign_lease"],
      }),
    }),
    { persistence, registry },
  );

  assert.equal(result.status, "policy_denied");
  assert.equal(executed, 0);

  const key = buildIdempotencyKey({
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: "test.sign_lease",
    action: "test.sign_lease",
    mandateVersion: 1,
    request: { topic: "Sign the lease" },
  });
  const replayed = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: "test.sign_lease",
    action: "test.sign_lease",
    key,
    requestFingerprint: key,
  });
  // Retryable, not terminal: the person can take the action over, and a run
  // after that must be able to proceed rather than meet a `reserved` row.
  assert.equal(replayed.state, "failed_retryable");
});

test("an oversized output is terminal for the step and never re-runs the capability", async () => {
  // The provider already answered. Treating the byte bound as a retryable
  // execution error re-ran a write that had already landed, and counted every
  // repeat against the tool-call budget.
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  let executed = 0;
  registry.register({
    provider: "test-oversized",
    async discover() {
      return [
        {
          id: "test.oversized",
          provider: "test-oversized",
          name: "test.oversized",
          description: "Returns more than the event bound allows.",
          inputSchema: {},
          risk: { level: "low" as const, categories: ["read"] },
          trust: { level: "derived" as const, origin: INTERNAL_FIXTURE_ORIGIN },
          readOnly: true,
        },
      ];
    },
    async execute(): Promise<CapabilityExecutionResult> {
      executed += 1;
      return {
        executionId: "x",
        output: { blob: "x".repeat(20_000) },
        summary: "read",
        provenance: "test",
        trust: "untrusted" as const,
      };
    },
  });

  const sleeps: number[] = [];
  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Read something enormous",
        capabilityNames: ["test.oversized"],
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["test.oversized"],
        allowedTargets: ["test.oversized"],
      }),
      budgetLimits: { maxRetries: 3, maxToolCalls: 1 },
    }),
    { persistence, registry, sleep: async (ms) => void sleeps.push(ms) },
  );

  assert.equal(result.status, "failed");
  assert.equal(executed, 1, "retrying cannot make a delivered output smaller");
  assert.equal(sleeps.length, 0, "and must not burn backoff waiting to find that out");
  const failed = persistence.events.find((event) => event.type === "tool.failed");
  assert.equal((failed?.payload as { reason?: string }).reason, "output_too_large");
  assert.ok(!result.emittedEventTypes.includes("tool.completed"));
});

test("the persistence double refuses a terminal reservation with the code the live RPC raises", async () => {
  // Fidelity to `complete_idempotency`, which raises 55000 for a missing or
  // terminal row (supabase/migrations/20260826010000_deterministic_conflict_
  // codes.sql). The superseded migration used 40001, a serialization-failure
  // code that invites a blind retry, which is exactly wrong for a
  // deterministic business-rule refusal.
  const persistence = new InMemoryPersistence();
  const key = "idem_terminal_probe";
  await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    action: "internal.echo_research",
    key,
    requestFingerprint: key,
  });
  await persistence.completeIdempotency({ tenantId: "tenant-1", key, outcome: "succeeded" });

  for (const attempt of [
    () => persistence.completeIdempotency({ tenantId: "tenant-1", key, outcome: "succeeded" }),
    () => persistence.completeIdempotency({ tenantId: "tenant-1", key: "idem_absent", outcome: "succeeded" }),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.equal((error as { code?: string }).code, "55000");
      return true;
    });
  }
});

test("a JSON-encoded capability input reaches the adapter as the object it encodes", async () => {
  // The planner cannot emit a nested capability input: its structured-output
  // schema allows one flat primitive per capability and instructs the model to
  // JSON-encode anything richer. A real plan therefore hands
  // `shopify.find_and_prepare_cart` the string `'{"store":...,"query":...}'`,
  // and before this decode the adapter read no `query` at all and failed the
  // node claiming the storefront was unavailable.
  const persistence = new InMemoryPersistence();
  const registry = new CapabilityRegistry();
  const seen: JsonValue[] = [];
  const recordingAdapter: CapabilityAdapter = {
    provider: "shopify",
    async discover() {
      return [{
        id: "shopify.find_and_prepare_cart",
        provider: "shopify",
        name: "shopify.find_and_prepare_cart",
        description: "Search a storefront and prepare a cart",
        inputSchema: {},
        risk: { level: "medium", categories: ["external_write"] },
        trust: { level: "derived", origin: "https://www.thuma.co" },
        readOnly: false,
      }];
    },
    async execute(request): Promise<CapabilityExecutionResult> {
      seen.push(request.input);
      return {
        executionId: "exec-1",
        output: { ok: true },
        summary: "prepared a cart",
        provenance: "https://www.thuma.co",
        trust: "untrusted",
      };
    },
  };
  registry.register(recordingAdapter);

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "Lyra",
        roleLabel: "Purchase setup",
        objective: "Prepare a reversible cart",
        capabilityNames: ["shopify.find_and_prepare_cart"],
        capabilityInputs: {
          "shopify.find_and_prepare_cart":
            '{"store":"www.thuma.co","query":"queen solid wood bed frame"}',
        },
      },
      authority: baseAuthority({
        allowedCapabilityIds: ["shopify.find_and_prepare_cart"],
        allowedOrigins: ["https://www.thuma.co"],
        allowedTargets: ["shopify.find_and_prepare_cart"],
      }),
    }),
    { persistence, registry, sleep: async () => undefined },
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(seen, [{ store: "www.thuma.co", query: "queen solid wood bed frame" }]);
});

test("a capability input that is a plain string stays a string", async () => {
  // The internal worker's input is a bare topic, not an encoded object, and
  // decoding must not reshape it into one.
  const persistence = new InMemoryPersistence();
  const registry = registryWithFixture();

  const result = await runExecuteNode(
    baseInput({
      node: {
        clientId: "node-1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Research relocation fixtures",
        capabilityNames: ["internal.echo_research"],
        capabilityInputs: { "internal.echo_research": "Write a three line digest." },
      },
    }),
    { persistence, registry, sleep: async () => undefined },
  );

  assert.equal(result.status, "completed");
  const completed = persistence.events.find((event) => event.type === "tool.completed");
  assert.ok(
    JSON.stringify(completed?.payload).includes("Write a three line digest."),
    "the bare topic string should have reached the worker unchanged",
  );
});
