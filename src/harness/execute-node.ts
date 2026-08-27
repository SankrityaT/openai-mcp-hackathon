// Note: no `import "server-only"` here — see planner.ts for why (the
// package is not an installed dependency and plain `node --test` cannot
// resolve Next's bundler-only alias). Only invoked from the
// `cardea-execute-node` Inngest function, a server-only execution context.
// Relative (not `@/...`-aliased) imports below are deliberate: TypeScript's
// `paths` alias is a compile-time-only type resolution aid here (module:
// commonjs, moduleResolution: node) and is never rewritten in emitted JS, so
// any *value* import via `@/core/...` would fail to resolve under plain
// `node --test`. Type-only imports are unaffected (erased entirely), so
// `@/core/contracts/types` stays aliased for consistency with the rest of
// the harness; every imported value below uses a relative path instead.
import type { ActionCategory, Actor, AuthorityPolicy, BudgetLimits, JsonValue, MissionEventType, NodeStatus, TrustLevel } from "@/core/contracts/types";
import { assertBoundedJson } from "../core/contracts/validation";
import { buildIdempotencyKey } from "../core/idempotency";
import { evaluatePolicy, type PolicyInput } from "../core/policy/engine";
import { BudgetTracker, backoffDelayMs } from "./budget";
import type { CapabilityRegistry } from "./capability-registry";
import type { HarnessPersistencePort } from "./contracts";

const DEFAULT_ACTOR: Actor = { kind: "cardea", id: "mission-harness" };
const MAX_TOOL_OUTPUT_BYTES = 8_192;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ExecuteNodeInput = {
  tenantId: string;
  missionId: string;
  nodeId: string;
  node: {
    clientId: string;
    codename: string;
    roleLabel: string;
    objective: string;
    capabilityNames: string[];
  };
  mandateVersion: number;
  authority: AuthorityPolicy;
  budgetLimits: BudgetLimits;
  /** Next event sequence this node run should append. */
  expectedSequence: number;
  correlationId: string;
  actor?: Actor;
};

export type ExecuteNodeStatus =
  | "completed"
  | "failed"
  | "policy_denied"
  | "approval_required"
  | "budget_exhausted";

export type ExecuteNodeResult = {
  status: ExecuteNodeStatus;
  /** Next sequence number the caller should use for any further append. */
  nextSequence: number;
  emittedEventTypes: MissionEventType[];
  approvalId?: string;
};

export type ExecuteNodeDeps = {
  persistence: HarnessPersistencePort;
  registry: CapabilityRegistry;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function runExecuteNode(input: ExecuteNodeInput, deps: ExecuteNodeDeps): Promise<ExecuteNodeResult> {
  const actor = input.actor ?? DEFAULT_ACTOR;
  const persistence = deps.persistence;
  const sleep = deps.sleep ?? defaultSleep;
  const budget = new BudgetTracker(input.budgetLimits, deps.now);
  let sequence = input.expectedSequence;
  const emitted: MissionEventType[] = [];

  async function append(
    type: MissionEventType,
    payload: JsonValue,
    options?: { trust?: TrustLevel; idempotencyKey?: string; nodeStatus?: NodeStatus },
  ) {
    // Every appended event carries a deterministic idempotency key tied to
    // its (mission, node, type, sequence-slot) position. If the enclosing
    // Inngest step retries after a partial failure, the repository's exact-
    // retry dedup (see docs/CORE_DATA_POLICY.md `append_mission_event`)
    // recognizes the identical key + payload and returns the already-
    // committed event instead of rejecting the retry as a stale writer.
    const key = options?.idempotencyKey ?? `event:${input.missionId}:${input.nodeId}:${type}:${sequence}`;
    // `materialization.nodeStatus` is what actually flips the materialized
    // `mission_nodes.status` column via `append_mission_event`
    // (`p_node_status`); the event payload alone never does this. See
    // supabase/migrations/20260826000200_transactions_and_guards.sql.
    const event = await persistence.appendEvent({
      missionId: input.missionId,
      nodeId: input.nodeId,
      expectedSequence: sequence,
      type,
      actor,
      correlationId: input.correlationId,
      idempotencyKey: key,
      payload,
      trust: options?.trust ?? "derived",
      materialization: options?.nodeStatus ? { nodeStatus: options.nodeStatus } : undefined,
    });
    sequence = event.sequence + 1;
    emitted.push(type);
    return event;
  }

  function stop(status: ExecuteNodeStatus, approvalId?: string): ExecuteNodeResult {
    return { status, nextSequence: sequence, emittedEventTypes: emitted, approvalId };
  }

  async function emitBudgetExhausted(kind: string, used: number, limit: number) {
    await append("quota.consumed", { kind, used, limit, exhausted: true });
    await append("node.failed", { nodeId: input.nodeId, reason: "budget_exhausted", kind }, { nodeStatus: "failed" });
  }

  await append("node.started", { nodeId: input.nodeId, objective: input.node.objective }, { nodeStatus: "running" });

  const capabilities = await deps.registry.discover();
  await append("capability.discovered", {
    available: capabilities.map((capability) => capability.id),
    requested: input.node.capabilityNames,
  });

  let anyFailed = false;

  for (const capabilityName of input.node.capabilityNames) {
    const duration = budget.checkDuration();
    if (!duration.ok) {
      await emitBudgetExhausted(duration.kind, duration.used, duration.limit);
      return stop("budget_exhausted");
    }

    const capability = capabilities.find((candidate) => candidate.name === capabilityName);
    if (!capability) {
      await append("tool.failed", { capabilityName, reason: "capability_not_found" });
      anyFailed = true;
      continue;
    }

    const toolCallBudget = budget.checkToolCall();
    if (!toolCallBudget.ok) {
      await emitBudgetExhausted(toolCallBudget.kind, toolCallBudget.used, toolCallBudget.limit);
      return stop("budget_exhausted");
    }

    const requestInput: JsonValue = { topic: input.node.objective };
    const idempotencyKey = buildIdempotencyKey({
      missionId: input.missionId,
      nodeId: input.nodeId,
      capabilityId: capability.id,
      action: capability.name,
      mandateVersion: input.mandateVersion,
      request: requestInput,
    });

    await append(
      "tool.requested",
      { capabilityId: capability.id, capabilityName: capability.name },
      { idempotencyKey },
    );

    // schema validation -> quota -> policy -> approval if required -> idempotency -> execute -> verify -> event commit
    //
    // The idempotency key is checked/reserved before `evaluatePolicy` runs
    // because the policy engine itself requires the current idempotency
    // state as an input (a "succeeded" prior attempt must replay through
    // policy as an allow, an in-flight "reserved" attempt must deny). This
    // reservation never triggers capability execution by itself: execution
    // only happens after policy explicitly allows below.
    const reservation = await persistence.reserveIdempotency({
      tenantId: input.tenantId,
      missionId: input.missionId,
      nodeId: input.nodeId,
      capabilityId: capability.id,
      action: capability.name,
      key: idempotencyKey,
      requestFingerprint: idempotencyKey,
    });

    const actionCategory: ActionCategory = "read";
    const policyInput: PolicyInput = {
      mandate: { version: input.mandateVersion, authority: input.authority },
      userAuthority: { authenticated: true, canTakeover: true, reauthenticatedForAction: false },
      contextCardOverrides: [],
      capability: {
        id: capability.id,
        riskLevel: capability.risk.level,
        riskCategories: capability.risk.categories as ActionCategory[],
        trust: capability.trust.level,
      },
      tool: {
        readOnly: capability.readOnly,
        destructive: false,
        idempotent: true,
        externalSideEffect: false,
        sensitive: false,
        requiresUserPresence: false,
      },
      action: {
        category: actionCategory,
        fingerprint: idempotencyKey,
        estimatedCostMicrounits: 0,
      },
      origin: capability.trust.origin ?? "https://internal.cardea.local",
      target: capability.id,
      quota: { exhausted: false },
      budget: {
        exhausted: false,
        estimatedCostMicrounits: 0,
        spentCostMicrounits: 0,
        limitCostMicrounits: input.budgetLimits.maxCostMicrounits ?? Number.MAX_SAFE_INTEGER,
      },
      idempotencyState: reservation.state,
    };

    const decision = evaluatePolicy(policyInput);

    if (decision.effect === "deny") {
      await append("policy.denied", {
        capabilityId: capability.id,
        code: decision.code,
        reasons: decision.reasons,
      });
      if (reservation.state === "new") {
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "failed_terminal",
        });
      }
      await append(
        "node.failed",
        { nodeId: input.nodeId, reason: "policy_denied", code: decision.code },
        { nodeStatus: "failed" },
      );
      return stop("policy_denied");
    }

    if (decision.effect === "require_approval") {
      const approval = await persistence.requestApproval({
        missionId: input.missionId,
        nodeId: input.nodeId,
        expectedSequence: sequence,
        category: actionCategory,
        actionFingerprint: idempotencyKey,
        recommendation: `Execute ${capability.name} for node ${input.node.codename}`,
        alternatives: [],
        evidence: [],
        consequence: "Executes a policy-gated internal capability call.",
        mandateVersion: input.mandateVersion,
        actor,
        correlationId: input.correlationId,
        idempotencyKey: `approval:${idempotencyKey}`,
      });
      // `requestApproval` durably appends exactly one `approval.requested`
      // event as part of the atomic approval-request operation.
      sequence += 1;
      await append(
        "node.paused",
        { nodeId: input.nodeId, reason: "approval_required", approvalId: approval.id },
        { nodeStatus: "needs_approval" },
      );
      return stop("approval_required", approval.id);
    }

    if (decision.effect === "require_takeover" || decision.effect === "require_reauthentication") {
      await append("policy.denied", {
        capabilityId: capability.id,
        code: decision.code,
        reasons: decision.reasons,
      });
      await append(
        "node.failed",
        { nodeId: input.nodeId, reason: decision.effect, code: decision.code },
        { nodeStatus: "failed" },
      );
      return stop("policy_denied");
    }

    if (decision.replayExistingResult && reservation.storedResult !== undefined) {
      await append(
        "tool.completed",
        { capabilityId: capability.id, replayed: true, output: reservation.storedResult },
        { trust: "untrusted", idempotencyKey },
      );
      continue;
    }

    await append("tool.started", { capabilityId: capability.id }, { idempotencyKey });

    let attempt = 0;
    let executed = false;
    let lastError: unknown;
    while (!executed) {
      try {
        const result = await deps.registry.execute({
          capabilityId: capability.id,
          missionId: input.missionId,
          nodeId: input.nodeId,
          input: requestInput,
          correlationId: input.correlationId,
          idempotencyKey,
        });
        budget.recordToolCall();
        const boundedOutput = assertBoundedJson(result.output, "toolResult.output", MAX_TOOL_OUTPUT_BYTES);
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "succeeded",
          result: boundedOutput,
        });
        await append(
          "tool.completed",
          { capabilityId: capability.id, summary: result.summary, provenance: result.provenance, output: boundedOutput },
          { trust: result.trust, idempotencyKey },
        );
        await append(
          "evidence.recorded",
          { capabilityId: capability.id, provenance: result.provenance, summary: result.summary },
          { trust: result.trust },
        );
        await persistence.recordUsage({
          tenantId: input.tenantId,
          missionId: input.missionId,
          nodeId: input.nodeId,
          subjectKind: "node",
          subjectId: input.nodeId,
          metric: "tool_calls",
          quantity: 1,
          costMicrounits: 0,
          limitQuantity: input.budgetLimits.maxToolCalls ?? Number.MAX_SAFE_INTEGER,
          limitCostMicrounits: input.budgetLimits.maxCostMicrounits ?? Number.MAX_SAFE_INTEGER,
          windowStart: new Date(0).toISOString(),
          windowEnd: new Date(8640000000000000).toISOString(),
          idempotencyKey: `usage:${idempotencyKey}`,
          correlationId: input.correlationId,
        });
        executed = true;
      } catch (error) {
        lastError = error;
        budget.recordRetry();
        attempt += 1;
        const retryCheck = budget.checkRetry();
        if (!retryCheck.ok) {
          await persistence.completeIdempotency({
            tenantId: input.tenantId,
            key: idempotencyKey,
            outcome: "failed_terminal",
            result: { message: error instanceof Error ? error.message : String(error) },
          });
          await append("tool.failed", {
            capabilityId: capability.id,
            reason: "max_retries_exhausted",
            message: error instanceof Error ? error.message : String(error),
          });
          anyFailed = true;
          break;
        }
        await sleep(backoffDelayMs(attempt));
      }
    }
    if (!executed) {
      void lastError;
      continue;
    }
  }

  if (anyFailed) {
    await append(
      "node.failed",
      { nodeId: input.nodeId, reason: "capability_execution_failed" },
      { nodeStatus: "failed" },
    );
    return stop("failed");
  }

  await append("node.completed", { nodeId: input.nodeId }, { nodeStatus: "completed" });
  return stop("completed");
}
