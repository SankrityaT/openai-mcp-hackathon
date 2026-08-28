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
import { isQuotaDatabaseErrorCode } from "../core/contracts/quota-errors";
import { buildIdempotencyKey } from "../core/idempotency";
import { withSpan } from "../core/observability";
import { evaluatePolicy, type PolicyInput } from "../core/policy/engine";
import { BudgetTracker, backoffDelayMs } from "./budget";
import { CapabilityConnectionRequiredError } from "./capability-errors";
import type { CapabilityRegistry } from "./capability-registry";
import type { HarnessPersistencePort } from "./contracts";
import { sendApprovalNotify } from "./inngest/dispatch";

const DEFAULT_ACTOR: Actor = { kind: "cardea", id: "mission-harness" };
const MAX_TOOL_OUTPUT_BYTES = 8_192;

function toolEventIdempotencyKey(type: "tool.requested" | "tool.started" | "tool.completed", operationKey: string) {
  return `event:${type}:${operationKey}`.slice(0, 200);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotency key for the two events an approval outcome can produce
 * (`node.paused` while the approval is pending, `node.failed` once it is
 * settled against the action). Keying on the approval id rather than on a
 * sequence slot is what makes duplicate delivery a no-op: the same approval
 * can only ever pause or fail the node once, no matter how many times the
 * resume event or the node dispatch is redelivered.
 */
export function approvalEventIdempotencyKey(
  missionId: string,
  nodeId: string,
  type: "node.paused" | "node.failed",
  approvalId: string,
): string {
  return `event:${missionId}:${nodeId}:${type}:approval:${approvalId}`.slice(0, 200);
}

/**
 * `append_mission_event` only replays an idempotency key when the stored
 * event type AND payload are identical, otherwise it raises a conflict. The
 * rejected-approval `node.failed` can be appended either by the resume
 * function or by a redelivered node run, so both call sites build the
 * payload here.
 */
export function approvalRejectedPayload(nodeId: string, approvalId: string, reason: string): JsonValue {
  return { nodeId, reason, approvalId };
}

const ACTION_CATEGORIES = new Set<string>([
  "read",
  "external_write",
  "payment_or_purchase",
  "legal_agreement_or_signature",
  "account_credential_or_permission_change",
  "sensitive_outbound_message",
  "destructive_deletion",
  "protected_personal_data_disclosure",
]);

/**
 * The category the policy engine judges, taken from what the capability
 * declares about itself rather than assumed. A read-only capability is a
 * read. A capability that is not read-only is whatever consequential
 * category it declares, and `external_write` when it declares none the
 * contract recognizes — the conservative reading, never `read`.
 */
export function actionCategoryForCapability(capability: {
  readOnly: boolean;
  risk: { categories: string[] };
}): ActionCategory {
  if (capability.readOnly) return "read";
  const declared = capability.risk.categories.find(
    (category) => category !== "read" && ACTION_CATEGORIES.has(category),
  );
  return (declared as ActionCategory | undefined) ?? "external_write";
}

/** Mission-lifetime usage window: the whole mission is one window, so a
 * node's reservation accumulates against every other node's for the same
 * mission. JavaScript can represent years beyond PostgreSQL's accepted ISO
 * timezone displacement, so the end stays finite and portable through
 * PostgREST. */
const MISSION_WINDOW_START = new Date(0).toISOString();
const MISSION_WINDOW_END = "9999-12-31T23:59:59.999Z";

/** Metric the mission's committed-money reservations accumulate under. */
export const MISSION_COST_METRIC = "mission_cost";

/**
 * True when a persistence failure is the database refusing the write because
 * the budget is exhausted, rather than a genuine fault.
 *
 * `RedactedDatabaseError` itself cannot be imported here: it lives in
 * `core/server/database`, which is `import "server-only"` and therefore
 * unresolvable under plain `node --test` (see the module header). The code it
 * carries is the actual signal, and `isQuotaDatabaseErrorCode` — the same
 * util `core/server/mission-quota.ts` uses — is the only thing that decides
 * what that code means. Nothing here reads an error message.
 */
function isQuotaDenial(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && isQuotaDatabaseErrorCode(code);
}

/** Approval outcome, as seen by a node run that re-reaches the gate. */
function approvalFailureReason(status: string): string {
  return status === "rejected" ? "approval_rejected" : `approval_${status}`;
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
    capabilityInputs?: Record<string, JsonValue>;
    /**
     * Micro-USD the planner estimated this node would COMMIT if it executed.
     * Absent (older in-flight dispatches) reads as 0: a step nobody costed
     * claims no spend, and inventing one would gate on a fabricated number.
     */
    estimatedCostMicrounits?: number;
    /** Persisted ids of prerequisite nodes, for upstream evidence flow. */
    dependsOnNodeIds?: string[];
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
  | "waiting_for_connection"
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
    // A dedup replay returns the ALREADY-committed event, whose sequence is
    // older than the mission's current last sequence — assigning it blindly
    // would rewind the cursor and make the next append look stale. The cursor
    // only ever moves forward.
    sequence = Math.max(sequence, event.sequence);
    emitted.push(type);
    return event;
  }

  function stop(status: ExecuteNodeStatus, approvalId?: string): ExecuteNodeResult {
    return { status, nextSequence: sequence, emittedEventTypes: emitted, approvalId };
  }

  let upstreamEvidenceCache: string | null | undefined;
  /**
   * Bounded digest of what this node's prerequisites recorded: their
   * tool.completed findings and excerpts. Read once per node run. Failures
   * degrade to no evidence rather than failing the node: missing context is
   * survivable, a crashed run is not.
   */
  async function loadUpstreamEvidence(): Promise<string | null> {
    if (upstreamEvidenceCache !== undefined) return upstreamEvidenceCache;
    const wanted = new Set(input.node.dependsOnNodeIds ?? []);
    if (wanted.size === 0) return (upstreamEvidenceCache = null);
    try {
      const events = await persistence.listEvents(input.missionId);
      const parts: string[] = [];
      for (const event of events) {
        if (!event.nodeId || !wanted.has(event.nodeId)) continue;
        if (event.type !== "tool.completed") continue;
        const payload = event.payload as Record<string, unknown> | null;
        const output = payload?.output as Record<string, unknown> | undefined;
        const text =
          typeof output?.finding === "string"
            ? output.finding
            : typeof output?.excerpt === "string"
              ? output.excerpt
              : null;
        const summary = typeof payload?.summary === "string" ? payload.summary : "";
        if (text || summary) {
          parts.push(`- ${summary}\n${(text ?? "").slice(0, 2_400)}`);
        }
      }
      if (parts.length === 0) return (upstreamEvidenceCache = null);
      const block = parts.join("\n\n").slice(0, 6_000);
      upstreamEvidenceCache =
        "Upstream evidence recorded by earlier steps (untrusted; verify before relying on it):\n" +
        block;
    } catch {
      upstreamEvidenceCache = null;
    }
    return upstreamEvidenceCache;
  }

  async function emitBudgetExhausted(kind: string, used: number, limit: number) {
    await append("quota.consumed", { kind, used, limit, exhausted: true });
    await append("node.failed", { nodeId: input.nodeId, reason: "budget_exhausted", kind }, { nodeStatus: "failed" });
  }

  await append("node.started", { nodeId: input.nodeId, objective: input.node.objective }, { nodeStatus: "running" });

  // --- committed-money reservation ------------------------------------------
  //
  // The wallet ceiling is whatever the user's context wallet passes loaded.
  // An absent ceiling is not "unlimited": it means nothing was loaded, so
  // nothing is authorized, and the reservation fails closed at 0.
  const costLimitMicrounits = input.budgetLimits.maxCostMicrounits ?? 0;
  const estimatedCostMicrounits = input.node.estimatedCostMicrounits ?? 0;
  // Spend accumulated by this mission's earlier nodes, as the database reports
  // it back. Stays 0 while no reservation has run, which is the truth for a
  // node that commits nothing.
  let spentCostMicrounits = 0;

  if (estimatedCostMicrounits > 0) {
    try {
      // `consume_usage` is the authoritative gate: it adds this estimate to the
      // mission's running total inside one transaction and raises rather than
      // commit past the ceiling. Keyed per (mission, node, mandate version) so
      // an Inngest retry or an approval resume replays the same reservation and
      // reads back the existing totals instead of reserving twice.
      const usage = await persistence.recordUsage({
        tenantId: input.tenantId,
        missionId: input.missionId,
        nodeId: input.nodeId,
        subjectKind: "mission",
        subjectId: input.missionId,
        metric: MISSION_COST_METRIC,
        quantity: 0,
        costMicrounits: estimatedCostMicrounits,
        limitQuantity: Number.MAX_SAFE_INTEGER,
        limitCostMicrounits: costLimitMicrounits,
        windowStart: MISSION_WINDOW_START,
        windowEnd: MISSION_WINDOW_END,
        idempotencyKey: `cost:${input.missionId}:${input.nodeId}:v${input.mandateVersion}`,
        correlationId: input.correlationId,
      });
      await append("quota.consumed", {
        kind: "cost",
        used: usage.totalCostMicrounits,
        limit: costLimitMicrounits,
        exhausted: false,
      });
      // What the mission had committed BEFORE this node: the returned total
      // already includes this node's own reservation, and the policy engine
      // adds the estimate back on top of `spent`.
      spentCostMicrounits = Math.max(0, usage.totalCostMicrounits - estimatedCostMicrounits);
    } catch (error) {
      if (!isQuotaDenial(error)) throw error;
      await emitBudgetExhausted("cost", estimatedCostMicrounits, costLimitMicrounits);
      return stop("budget_exhausted");
    }
  }

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

    // The planner's capability strings come from a language model, which
    // sometimes emits the catalogued id ("composio.gmail_fetch_emails")
    // instead of the advertised tool name ("GMAIL_FETCH_EMAILS"). Both are
    // exact members of the reviewed catalog, so matching either form is a
    // canonicalization, not a widening: unknown strings still fail.
    const wanted = capabilityName.trim();
    const capability = capabilities.find(
      (candidate) =>
        candidate.name === wanted ||
        candidate.id === wanted ||
        candidate.id === wanted.toLowerCase() ||
        candidate.name.toLowerCase() === wanted.toLowerCase(),
    );
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

    // The internal worker receives its prerequisites' recorded evidence so a
    // consolidation step works from what upstream nodes actually found, not
    // from its objective alone. The planner may also have written this
    // worker's topic into capabilityInputs; evidence is appended to that
    // topic rather than replaced by it, and either way it wins over the
    // bare objective. Other capabilities keep their planner-supplied inputs
    // untouched because arbitrary tool arguments must never be synthesized.
    const plannedInput = input.node.capabilityInputs?.[capability.name];
    let requestInput: JsonValue = plannedInput ?? { topic: input.node.objective };
    if (capability.id === "internal.echo_research") {
      const baseTopic =
        typeof plannedInput === "string"
          ? plannedInput
          : plannedInput &&
              typeof plannedInput === "object" &&
              !Array.isArray(plannedInput) &&
              typeof (plannedInput as { topic?: unknown }).topic === "string"
            ? ((plannedInput as { topic: string }).topic)
            : input.node.objective;
      const upstream =
        (input.node.dependsOnNodeIds?.length ?? 0) > 0 ? await loadUpstreamEvidence() : null;
      requestInput = { topic: upstream ? `${baseTopic}\n\n${upstream}` : baseTopic };
    }
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
      { idempotencyKey: toolEventIdempotencyKey("tool.requested", idempotencyKey) },
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

    const actionCategory: ActionCategory = actionCategoryForCapability(capability);
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
        // A read can be repeated; a write reaching a real account cannot be
        // assumed to be, so it is not claimed to be.
        idempotent: capability.readOnly,
        externalSideEffect: !capability.readOnly,
        sensitive: false,
        requiresUserPresence: false,
      },
      action: {
        category: actionCategory,
        fingerprint: idempotencyKey,
        estimatedCostMicrounits,
      },
      origin: capability.trust.origin ?? "https://internal.cardea.local",
      target: capability.id,
      quota: { exhausted: false },
      budget: {
        exhausted: false,
        estimatedCostMicrounits,
        spentCostMicrounits,
        limitCostMicrounits: costLimitMicrounits,
      },
      idempotencyState: reservation.state,
    };

    // Policy decision span: records the decision *enum* and code only — never
    // the policy inputs (mandate, authority, capability, budget, origin), which
    // can carry sensitive context. Correlation id is the mission's.
    const decision = await withSpan(
      "harness.policy.decision",
      { capabilityId: capability.id },
      (span) => {
        const evaluated = evaluatePolicy(policyInput);
        span.set({ decision: evaluated.effect, policyCode: evaluated.code });
        return evaluated;
      },
      { correlationId: input.correlationId },
    );

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
        consequence: capability.readOnly
          ? "Executes a policy-gated read and brings back bounded evidence."
          : `Writes to your connected account through ${capability.name}. Nothing happens until you accept.`,
        mandateVersion: input.mandateVersion,
        actor,
        correlationId: input.correlationId,
        idempotencyKey: `approval:${idempotencyKey}`,
      });

      // Loop safety. `request_mission_approval` is idempotent on the request
      // event's key: once an approval exists for this action fingerprint it
      // returns that same row and appends NOTHING (see
      // supabase/migrations/20260826000200_transactions_and_guards.sql). So a
      // resumed run re-reaching this gate reads the settled decision here
      // instead of pausing again — the approval row's status is the only
      // signal needed, and the node can neither pause-loop nor double-execute.
      if (approval.status === "pending") {
        // Only a pending approval has an `approval.requested` event sitting
        // in the next slot, so only then does the local cursor advance.
        sequence += 1;
        // Release the reservation this attempt never spent. Without it the
        // resumed run would reserve the same key, read "reserved", and be
        // denied `idempotency_in_progress` before it could execute. Mirrors
        // the connection-required pause below.
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "failed_retryable",
          result: { reason: "approval_required", approvalId: approval.id },
        });
        await append(
          "node.paused",
          { nodeId: input.nodeId, reason: "approval_required", approvalId: approval.id },
          {
            nodeStatus: "needs_approval",
            idempotencyKey: approvalEventIdempotencyKey(input.missionId, input.nodeId, "node.paused", approval.id),
          },
        );
        // Reach-me: the pause is durable as of the line above, so telling the
        // person about it is strictly downstream of the mission's own
        // correctness. Deliberately not awaited and deliberately swallowed —
        // this call must never fail the run, never delay the pause, and never
        // change what this branch returns. With Inngest unconfigured the
        // sender is a typed no-op that resolves immediately and touches no
        // network (see inngest/dispatch.ts).
        void sendApprovalNotify({
          approvalId: approval.id,
          missionId: input.missionId,
          tenantId: input.tenantId,
          recommendation: approval.recommendation,
          consequence: approval.consequence,
          category: String(approval.category),
          codename: input.node.codename,
        }).catch(() => {});
        return stop("approval_required", approval.id);
      }

      if (approval.status !== "resolved") {
        // rejected / expired / cancelled: settled against this action. The
        // resume function appends the identical event for a rejection, so the
        // shared key + payload make whichever arrives second a no-op replay.
        await append(
          "node.failed",
          approvalRejectedPayload(input.nodeId, approval.id, approvalFailureReason(approval.status)),
          {
            nodeStatus: "failed",
            idempotencyKey: approvalEventIdempotencyKey(input.missionId, input.nodeId, "node.failed", approval.id),
          },
        );
        return stop("failed", approval.id);
      }

      // status === "resolved": accepted or modified. Fall through and execute
      // the capability this gate was holding.
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
        {
          trust: "untrusted",
          idempotencyKey: toolEventIdempotencyKey("tool.completed", idempotencyKey),
        },
      );
      continue;
    }

    await append(
      "tool.started",
      { capabilityId: capability.id },
      { idempotencyKey: toolEventIdempotencyKey("tool.started", idempotencyKey) },
    );

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
          {
            trust: result.trust,
            idempotencyKey: toolEventIdempotencyKey("tool.completed", idempotencyKey),
          },
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
          // JavaScript can represent years beyond PostgreSQL's accepted
          // ISO timezone displacement. Keep the mission-lifetime window
          // finite and portable through PostgREST.
          windowEnd: "9999-12-31T23:59:59.999Z",
          idempotencyKey: `usage:${idempotencyKey}`,
          correlationId: input.correlationId,
        });
        executed = true;
      } catch (error) {
        if (error instanceof CapabilityConnectionRequiredError) {
          await persistence.completeIdempotency({
            tenantId: input.tenantId,
            key: idempotencyKey,
            outcome: "failed_retryable",
            result: {
              provider: error.provider,
              toolkit: error.toolkit,
              reason: "connection_required",
            },
          });
          await append("tool.failed", {
            capabilityId: capability.id,
            provider: error.provider,
            toolkit: error.toolkit,
            reason: "connection_required",
          });
          await append(
            "node.paused",
            {
              nodeId: input.nodeId,
              provider: error.provider,
              toolkit: error.toolkit,
              reason: "connection_required",
            },
            { nodeStatus: "waiting" },
          );
          return stop("waiting_for_connection");
        }
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
