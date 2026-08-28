import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovalStatus,
  AuthorityPolicy,
  JsonValue,
  MissionApproval,
  MissionEvent,
  MissionEventType,
} from "@/core/contracts/types";
import type {
  AppendMissionEventCommand,
  RequestApprovalCommand,
} from "@/core/repositories/mission-repository";
import {
  ASK_USER_CAPABILITY_ID,
  ASK_USER_ORIGIN,
  AskUserInputError,
  AskUserNotExecutableError,
  askUserAdapter,
  askUserAnswer,
  askUserApprovalCopy,
  askUserSummary,
  readAskUserInput,
} from "./adapters/ask-user";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  InternalFixtureAdapter,
} from "./adapters/internal-fixture";
import { CapabilityRegistry } from "./capability-registry";
import { runExecuteNode, type ExecuteNodeInput } from "./execute-node";
import { InMemoryPersistence } from "./persistence/in-memory-persistence";

/* ---- the adapter, on its own -------------------------------------------- */

const QUESTION = {
  question: "which style do you want?",
  options: ["walnut mid-century", "white minimal", "industrial"],
  recommended: "white minimal",
};

test("the question is read from the JSON string a real plan can carry", () => {
  // The planner's structured output carries one flat primitive per capability
  // (see planner.ts), so this encoded form is the shape a real plan produces.
  const ask = readAskUserInput(JSON.stringify(QUESTION));
  assert.deepEqual(ask, {
    question: "which style do you want?",
    options: ["walnut mid-century", "white minimal", "industrial"],
    recommended: "white minimal",
  });
});

test("the already-decoded object form is read identically", () => {
  assert.deepEqual(readAskUserInput(QUESTION as unknown as JsonValue), readAskUserInput(JSON.stringify(QUESTION)));
});

test("a question with fewer than two distinct options is refused, never asked", () => {
  assert.throws(
    () => readAskUserInput({ question: "which one?", options: ["only this"] } as unknown as JsonValue),
    AskUserInputError,
  );
  // Two spellings of the same option are not a choice.
  assert.throws(
    () =>
      readAskUserInput({
        question: "which one?",
        options: ["Walnut Mid-Century", "walnut mid-century"],
      } as unknown as JsonValue),
    AskUserInputError,
  );
});

test("a question with more than four options is refused", () => {
  assert.throws(
    () =>
      readAskUserInput({
        question: "which one?",
        options: ["a", "b", "c", "d", "e"],
      } as unknown as JsonValue),
    AskUserInputError,
  );
});

test("an option longer than the display bound is refused rather than silently cut", () => {
  assert.throws(
    () =>
      readAskUserInput({
        question: "which one?",
        options: ["a".repeat(61), "b"],
      } as unknown as JsonValue),
    AskUserInputError,
  );
});

test("a recommendation naming no offered option falls back to the first option", () => {
  const ask = readAskUserInput({
    question: "which style do you want?",
    options: ["walnut mid-century", "white minimal"],
    recommended: "chrome and glass",
  } as unknown as JsonValue);
  assert.equal(ask.recommended, "walnut mid-century");
});

test("the approval copy carries the question, so the card never shows a bare answer", () => {
  const copy = askUserApprovalCopy(readAskUserInput(JSON.stringify(QUESTION)));
  assert.ok(copy.recommendation.includes("which style do you want?"));
  assert.ok(copy.recommendation.includes("white minimal"));
  assert.ok(!copy.recommendation.includes("—"), "product copy carries no em dash");
  assert.ok(!copy.consequence.includes("—"), "product copy carries no em dash");
});

test("Accept means the suggestion, and a written note is itself the answer", () => {
  const ask = readAskUserInput(JSON.stringify(QUESTION));
  assert.equal(askUserAnswer(ask, {}), "white minimal");
  assert.equal(askUserAnswer(ask, null), "white minimal");
  assert.equal(askUserAnswer(ask, { note: "  oak, but low  " }), "oak, but low");
});

test("the summary is the answer, bounded to a UI-safe length", () => {
  assert.equal(askUserSummary("white minimal"), "answered: white minimal");
  assert.equal(askUserSummary("x".repeat(400)).length, 160);
});

test("the adapter advertises a low-risk read on its own origin, and its own provider key", async () => {
  const [capability] = await askUserAdapter.discover();
  assert.equal(capability.id, ASK_USER_CAPABILITY_ID);
  assert.equal(capability.provider, "cardea-ask");
  assert.notEqual(capability.provider, "cardea");
  assert.notEqual(capability.provider, "cardea-research");
  assert.equal(capability.readOnly, true);
  assert.deepEqual(capability.risk, { level: "low", categories: ["read"] });
  assert.equal(capability.trust.level, "derived");
  assert.equal(capability.trust.origin, ASK_USER_ORIGIN);
});

test("the adapter's description tells the planner to ask before the work that depends on it", async () => {
  const [capability] = await askUserAdapter.discover();
  assert.match(capability.description, /2 to 4 short options/);
  assert.match(capability.description, /BEFORE/);
  assert.match(capability.description, /taste, budget shape, or a choice among directions/);
  assert.match(capability.description, /Downstream steps receive the answer/);
});

test("executing the capability through the registry refuses rather than inventing an answer", async () => {
  await assert.rejects(
    () =>
      askUserAdapter.execute({
        capabilityId: ASK_USER_CAPABILITY_ID,
        missionId: "mission-1",
        input: JSON.stringify(QUESTION),
        correlationId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "idem_ask",
      }),
    AskUserNotExecutableError,
  );
});

test("the ask adapter registers alongside both browser adapters without a provider collision", async () => {
  const { webLookupAdapter, webResearchAdapter } = await import("./adapters/web-research");
  const registry = new CapabilityRegistry();
  registry.register(webLookupAdapter);
  registry.register(webResearchAdapter);
  assert.doesNotThrow(() => registry.register(askUserAdapter));
});

/* ---- the flow, through the executor ------------------------------------- */

/**
 * The same double `approval-resume.test.ts` uses, plus the resolution the
 * person's answer travels in. Both behaviors it mirrors are real SQL-layer
 * behaviors (see supabase/migrations/20260826000200_transactions_and_guards.sql):
 * `request_mission_approval` returns an existing approval without appending a
 * second request event, and `append_mission_event` replays a stored event when
 * key, type, and payload all match.
 */
class AskGatePersistence extends InMemoryPersistence {
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
  settleAll(status: ApprovalStatus, resolution: JsonValue = {}): void {
    for (const approval of this.approvalsByRequestKey.values()) {
      approval.status = status;
      approval.resolvedAt = new Date().toISOString();
      approval.resolution = resolution;
    }
  }

  lastSequence(): number {
    return this.events.length === 0 ? 0 : this.events[this.events.length - 1].sequence;
  }

  count(type: MissionEventType): number {
    return this.events.filter((event) => event.type === type).length;
  }
}

function askAuthority(): AuthorityPolicy {
  return {
    freePassage: true,
    allowedCapabilityIds: [ASK_USER_CAPABILITY_ID, INTERNAL_FIXTURE_CAPABILITY_ID],
    allowedOrigins: [ASK_USER_ORIGIN, INTERNAL_FIXTURE_ORIGIN],
    allowedTargets: [ASK_USER_CAPABILITY_ID, INTERNAL_FIXTURE_CAPABILITY_ID],
    allowedRiskLevels: ["low", "medium"],
    maxAutonomousCostMicrounits: 1_000,
    allowExternalSideEffects: false,
    requireApprovalCategories: [],
  };
}

function askInput(overrides: Partial<ExecuteNodeInput> = {}): ExecuteNodeInput {
  return {
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-ask",
    node: {
      clientId: "ask",
      codename: "vega",
      roleLabel: "Concierge",
      objective: "Ask which style the person wants",
      capabilityNames: [ASK_USER_CAPABILITY_ID],
      capabilityInputs: { [ASK_USER_CAPABILITY_ID]: JSON.stringify(QUESTION) },
    },
    mandateVersion: 1,
    authority: askAuthority(),
    budgetLimits: {},
    expectedSequence: 0,
    correlationId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

function askRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(askUserAdapter);
  return registry;
}

test("raising the question pauses the node with the options on the approval", async () => {
  const persistence = new AskGatePersistence();
  const result = await runExecuteNode(askInput(), { persistence, registry: askRegistry() });

  assert.equal(result.status, "approval_required");
  assert.ok(result.approvalId);
  assert.deepEqual(result.emittedEventTypes, [
    "node.started",
    "capability.discovered",
    "tool.requested",
    "node.paused",
  ]);
  assert.ok(!result.emittedEventTypes.includes("tool.started"), "a question is not a tool call");

  assert.equal(persistence.approvals.length, 1);
  const approval = persistence.approvals[0];
  assert.equal(approval.status, "pending");
  assert.equal(approval.category, "read");
  assert.ok(approval.recommendation.includes("which style do you want?"));
  assert.ok(approval.recommendation.includes("white minimal"));
  assert.deepEqual(approval.alternatives, [
    "walnut mid-century",
    "white minimal",
    "industrial",
  ]);

  const paused = persistence.events.find((event) => event.type === "node.paused");
  assert.deepEqual(paused?.payload, {
    nodeId: "node-ask",
    reason: "approval_required",
    approvalId: approval.id,
  });
});

test("the question never reaches the registry, so nothing can answer it but the person", async () => {
  const persistence = new AskGatePersistence();
  const registry = askRegistry();
  let executed = 0;
  const guarded = new Proxy(registry, {
    get(target, property, receiver) {
      if (property === "execute") {
        return async () => {
          executed += 1;
          throw new Error("the ask flow must never call registry.execute");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const paused = await runExecuteNode(askInput(), { persistence, registry: guarded });
  assert.equal(paused.status, "approval_required");
  persistence.settleAll("resolved");
  const resumed = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: guarded },
  );

  assert.equal(resumed.status, "completed");
  assert.equal(executed, 0);
});

test("resume: an accepted question completes the node with the suggested option as its output", async () => {
  const persistence = new AskGatePersistence();
  const paused = await runExecuteNode(askInput(), { persistence, registry: askRegistry() });
  assert.equal(paused.status, "approval_required");
  // Accept carries no note.
  persistence.settleAll("resolved", {});

  const resumed = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(resumed.status, "completed");
  const completed = persistence.events.find((event) => event.type === "tool.completed");
  assert.deepEqual((completed?.payload as { output?: JsonValue }).output, {
    question: "which style do you want?",
    answer: "white minimal",
  });
  assert.equal((completed?.payload as { summary?: string }).summary, "answered: white minimal");
  assert.equal(completed?.trust, "trusted", "the person said it themselves");
});

test("resume: a written answer is recorded verbatim as the node's output", async () => {
  const persistence = new AskGatePersistence();
  await runExecuteNode(askInput(), { persistence, registry: askRegistry() });
  persistence.settleAll("resolved", { note: "white minimal but in oak, under 800" });

  const resumed = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(resumed.status, "completed");
  const completed = persistence.events.find((event) => event.type === "tool.completed");
  assert.deepEqual((completed?.payload as { output?: JsonValue }).output, {
    question: "which style do you want?",
    answer: "white minimal but in oak, under 800",
  });
});

test("resume delivered twice records the answer once, with no duplicate events", async () => {
  const persistence = new AskGatePersistence();
  await runExecuteNode(askInput(), { persistence, registry: askRegistry() });
  persistence.settleAll("resolved", { note: "industrial" });

  const first = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );
  const second = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(persistence.count("approval.requested"), 1, "the gate must not ask a second time");
  assert.equal(persistence.count("node.paused"), 1, "only the original pause is durable");
  assert.equal(persistence.count("tool.completed"), 1);
  assert.equal(persistence.count("tool.started"), 1);
  assert.equal(persistence.approvals.length, 1);
});

test("a still-pending question replays the same pause instead of asking again", async () => {
  const persistence = new AskGatePersistence();
  await runExecuteNode(askInput(), { persistence, registry: askRegistry() });

  const replay = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(replay.status, "approval_required");
  assert.equal(persistence.count("node.paused"), 1);
  assert.equal(persistence.count("approval.requested"), 1);
  assert.equal(persistence.count("tool.started"), 0);
});

test("a declined question fails the node once, never guessing an answer", async () => {
  const persistence = new AskGatePersistence();
  await runExecuteNode(askInput(), { persistence, registry: askRegistry() });
  persistence.settleAll("rejected");

  const first = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );
  const second = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(first.status, "failed");
  assert.equal(second.status, "failed");
  assert.equal(persistence.count("node.failed"), 1, "duplicate delivery replays, never re-fails");
  assert.equal(persistence.count("tool.completed"), 0);
});

test("an unusable question fails the step visibly instead of being asked", async () => {
  const persistence = new AskGatePersistence();
  const result = await runExecuteNode(
    askInput({
      node: {
        clientId: "ask",
        codename: "vega",
        roleLabel: "Concierge",
        objective: "Ask which style the person wants",
        capabilityNames: [ASK_USER_CAPABILITY_ID],
        capabilityInputs: { [ASK_USER_CAPABILITY_ID]: "which style do you want?" },
      },
    }),
    { persistence, registry: askRegistry() },
  );

  assert.equal(result.status, "failed");
  assert.equal(persistence.approvals.length, 0, "an unusable question is never put to the person");
  const failed = persistence.events.find((event) => event.type === "tool.failed");
  assert.equal((failed?.payload as { reason?: string }).reason, "ask_user_input_invalid");
});

test("a dependent step receives the answer through the upstream evidence flow", async () => {
  const persistence = new AskGatePersistence();
  await runExecuteNode(askInput(), { persistence, registry: askRegistry() });
  persistence.settleAll("resolved", { note: "white minimal, oak accents" });
  const answered = await runExecuteNode(
    askInput({ expectedSequence: persistence.lastSequence() }),
    { persistence, registry: askRegistry() },
  );
  assert.equal(answered.status, "completed");

  let topic = "";
  const registry = new CapabilityRegistry();
  registry.register(
    new InternalFixtureAdapter(async (received) => {
      topic = received;
      return "Shortlist built from the stated preference.";
    }),
  );

  const dependent = await runExecuteNode(
    askInput({
      nodeId: "node-brief",
      expectedSequence: persistence.lastSequence(),
      node: {
        clientId: "brief",
        codename: "lyra",
        roleLabel: "Analyst",
        objective: "Shortlist pieces in the chosen style",
        capabilityNames: [INTERNAL_FIXTURE_CAPABILITY_ID],
        dependsOnNodeIds: ["node-ask"],
      },
    }),
    { persistence, registry },
  );

  assert.equal(dependent.status, "completed");
  assert.ok(
    topic.includes("Q: which style do you want? A: white minimal, oak accents"),
    `the dependent step must receive the question and the answer, got: ${topic}`,
  );
});
