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
import {
  ASK_USER_CAPABILITY_ID,
  ASK_USER_PROVENANCE,
  askUserAnswer,
  askUserApprovalCopy,
  askUserSummary,
  readAskUserInput,
  type AskUserRequest,
} from "./adapters/ask-user";
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

/**
 * What `complete_idempotency` stores for a succeeded tool call: everything
 * the original `tool.completed` payload carried beyond the raw output.
 * `append_mission_event` only replays an idempotency key when the event type
 * AND payload are identical, so a redelivered run must be able to rebuild
 * the exact original payload from the reservation alone; a "replayed"
 * variant payload under the same key is a 23505 conflict that wedges the
 * node permanently.
 */
type StoredToolCompletion = {
  output: JsonValue;
  summary: string;
  provenance: string;
  trust: TrustLevel;
};

const TRUST_LEVELS: ReadonlySet<string> = new Set(["trusted", "untrusted", "derived"]);

function storedToolCompletion(completion: StoredToolCompletion): JsonValue {
  return {
    output: completion.output,
    summary: completion.summary,
    provenance: completion.provenance,
    trust: completion.trust,
  };
}

/**
 * Reservations completed before this shape existed stored the bare output,
 * which cannot rebuild the original payload. Those return null, and the
 * replay path skips the append instead of committing a mismatched payload.
 */
function readStoredToolCompletion(stored: JsonValue | undefined): StoredToolCompletion | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const record = stored as Record<string, JsonValue>;
  if (record.output === undefined) return null;
  if (typeof record.summary !== "string" || typeof record.provenance !== "string") return null;
  if (typeof record.trust !== "string" || !TRUST_LEVELS.has(record.trust)) return null;
  return {
    output: record.output,
    summary: record.summary,
    provenance: record.provenance,
    trust: record.trust as TrustLevel,
  };
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
 * Remote-browser sessions burn paid Cloudflare minutes, so each launch is
 * debited against a per-tenant daily allowance before the session opens.
 * Operators (CARDEA_OPERATOR_USER_IDS) get a working allowance; everyone
 * else gets a small one until paid plans exist.
 */
export const BROWSER_SESSION_METRIC = "browser_session";
const BROWSER_SESSION_DAILY_LIMIT = 6;
const OPERATOR_BROWSER_SESSION_DAILY_LIMIT = 200;

function browserSessionDailyLimit(identityId: string): number {
  const raw = process.env.CARDEA_OPERATOR_USER_IDS ?? "";
  const operator = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(identityId);
  return operator ? OPERATOR_BROWSER_SESSION_DAILY_LIMIT : BROWSER_SESSION_DAILY_LIMIT;
}

function utcDayWindow(now: Date = new Date()): { windowStart: string; windowEnd: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

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
  /** Cardea identity running the mission; keys the operator allowances. */
  identityId?: string;
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
        let text =
          typeof output?.finding === "string"
            ? output.finding
            : typeof output?.excerpt === "string"
              ? output.excerpt
              : null;
        if (text && Array.isArray(output?.prices) && output.prices.length > 0) {
          const prices = (output.prices as unknown[])
            .filter((price) => typeof price === "string")
            .join(" ");
          if (prices) text = `Prices observed on the page: ${prices}\n${text}`;
        }
        if (text && Array.isArray(output?.ratings) && output.ratings.length > 0) {
          const ratings = (output.ratings as unknown[])
            .filter((rating) => typeof rating === "string")
            .join(" ");
          if (ratings) text = `Ratings observed on the page: ${ratings}\n${text}`;
        }
        // What the person said, when the prerequisite was an ask step. Carried
        // with its question attached, because "walnut mid-century" means
        // nothing downstream without knowing what was asked. This is the one
        // kind of upstream evidence that is trusted rather than untrusted; the
        // block's header still calls the whole digest untrusted, which is the
        // conservative reading and never the reverse.
        if (!text && typeof output?.question === "string" && typeof output?.answer === "string") {
          text = `Q: ${output.question} A: ${output.answer}`;
        }
        // Web research returns a results array; every read page's title and
        // excerpt is the evidence, and dropping them starved consolidation
        // into honest "nothing retained" briefs.
        if (!text && Array.isArray(output?.results)) {
          text = (output.results as Record<string, unknown>[])
            .filter((entry) => typeof entry?.excerpt === "string")
            .map((entry) => {
              const prices = Array.isArray(entry.prices)
                ? (entry.prices as unknown[]).filter((price) => typeof price === "string").join(" ")
                : "";
              const ratings = Array.isArray(entry.ratings)
                ? (entry.ratings as unknown[]).filter((rating) => typeof rating === "string").join(" ")
                : "";
              return `${typeof entry.title === "string" ? entry.title : entry.url}\nURL: ${String(entry.url)}${prices ? `\nPrices observed on the page: ${prices}` : ""}${ratings ? `\nRatings observed on the page: ${ratings}` : ""}\n${String(entry.excerpt).slice(0, 1_100)}`;
            })
            .join("\n\n");
          if (!text) text = null;
        }
        const summary = typeof payload?.summary === "string" ? payload.summary : "";
        if (text || summary) {
          parts.push(`- ${summary}\n${(text ?? "").slice(0, 3_400)}`);
        }
      }
      if (parts.length === 0) return (upstreamEvidenceCache = null);
      const block = parts.join("\n\n").slice(0, 10_000);
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

    // --- asking the person ---------------------------------------------------
    //
    // `cardea.ask_user` is not a tool call, so it never reaches
    // `registry.execute`. It raises the same approval an approval-gated write
    // raises, pauses the node the same way, and completes with what the person
    // said. Everything before this point still applied: the capability had to
    // be in the mandate, the policy engine had to allow it, and the
    // reservation had to be free.
    //
    // Reaching this gate again after the approval settles is how the answer is
    // read back, and it rests on the same property the gated-write resume
    // rests on: `request_mission_approval` is idempotent on the request
    // event's key, so it returns the existing row and appends nothing. That is
    // why a resumed run finds the settled decision here instead of pausing a
    // second time, and why no `resumeOfApprovalId` needs to be threaded in —
    // the approval row's own status is the signal.
    //
    // Placed ABOVE the stored-result replay on purpose: a redelivered run
    // after the answer was recorded re-derives the identical `tool.completed`
    // payload under the identical key, which `append_mission_event` replays,
    // rather than appending a second, differently shaped "replayed" event.
    if (capability.id === ASK_USER_CAPABILITY_ID) {
      let ask: AskUserRequest;
      try {
        ask = readAskUserInput(requestInput);
      } catch (error) {
        // An unusable question cannot be put in front of the person, and
        // guessing what was meant would fabricate the choice. The step fails
        // visibly instead.
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "failed_terminal",
          result: { reason: "ask_user_input_invalid" },
        });
        await append("tool.failed", {
          capabilityId: capability.id,
          reason: "ask_user_input_invalid",
          message: error instanceof Error ? error.message : String(error),
        });
        anyFailed = true;
        continue;
      }

      const copy = askUserApprovalCopy(ask);
      const question = await persistence.requestApproval({
        missionId: input.missionId,
        nodeId: input.nodeId,
        expectedSequence: sequence,
        category: actionCategory,
        actionFingerprint: idempotencyKey,
        recommendation: copy.recommendation,
        // The options themselves, as plain strings the card lists verbatim.
        alternatives: [...ask.options],
        evidence: [],
        consequence: copy.consequence,
        mandateVersion: input.mandateVersion,
        actor,
        correlationId: input.correlationId,
        idempotencyKey: `approval:${idempotencyKey}`,
      });

      if (question.status === "pending") {
        // Only a pending approval has an `approval.requested` event sitting in
        // the next slot, so only then does the local cursor advance.
        sequence += 1;
        // Release the reservation this attempt never spent, exactly as the
        // gated-write pause does: without it the resumed run would read
        // "reserved" and be denied before it could record the answer.
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "failed_retryable",
          result: { reason: "approval_required", approvalId: question.id },
        });
        await append(
          "node.paused",
          { nodeId: input.nodeId, reason: "approval_required", approvalId: question.id },
          {
            nodeStatus: "needs_approval",
            idempotencyKey: approvalEventIdempotencyKey(
              input.missionId,
              input.nodeId,
              "node.paused",
              question.id,
            ),
          },
        );
        // Reach-me, fire and forget, for the same reasons as the gated-write
        // pause: the pause is already durable, and telling the person about it
        // must never fail, delay, or change the run.
        void sendApprovalNotify({
          approvalId: question.id,
          missionId: input.missionId,
          tenantId: input.tenantId,
          recommendation: question.recommendation,
          consequence: question.consequence,
          category: String(question.category),
          codename: input.node.codename,
        }).catch(() => {});
        return stop("approval_required", question.id);
      }

      if (question.status !== "resolved") {
        // rejected / expired / cancelled. A preference question has no wrong
        // answer, so this is the person declining to answer or the question
        // going stale, and the step cannot invent one on their behalf.
        await append(
          "node.failed",
          approvalRejectedPayload(input.nodeId, question.id, approvalFailureReason(question.status)),
          {
            nodeStatus: "failed",
            idempotencyKey: approvalEventIdempotencyKey(
              input.missionId,
              input.nodeId,
              "node.failed",
              question.id,
            ),
          },
        );
        return stop("failed", question.id);
      }

      const answer = askUserAnswer(ask, question.resolution);
      const answered = { question: ask.question, answer } as JsonValue;
      const summary = askUserSummary(answer);
      await append(
        "tool.started",
        { capabilityId: capability.id },
        { idempotencyKey: toolEventIdempotencyKey("tool.started", idempotencyKey) },
      );
      // A redelivered run reads "succeeded" here, and `complete_idempotency`
      // refuses terminal rows, so only a first pass may complete. The append
      // below then reuses the stored completion so its payload stays
      // identical to what the first pass committed under the same key.
      const storedAnswer =
        reservation.state === "succeeded"
          ? readStoredToolCompletion(reservation.storedResult)
          : null;
      if (reservation.state !== "succeeded") {
        await persistence.completeIdempotency({
          tenantId: input.tenantId,
          key: idempotencyKey,
          outcome: "succeeded",
          result: storedToolCompletion({
            output: answered,
            summary,
            provenance: ASK_USER_PROVENANCE,
            trust: "trusted",
          }),
        });
      }
      const answeredOutput = storedAnswer
        ? storedAnswer.output
        : assertBoundedJson(answered, "toolResult.output", MAX_TOOL_OUTPUT_BYTES);
      const answeredSummary = storedAnswer ? storedAnswer.summary : summary;
      await append(
        "tool.completed",
        {
          capabilityId: capability.id,
          summary: answeredSummary,
          provenance: ASK_USER_PROVENANCE,
          output: answeredOutput,
        },
        {
          // The one trusted output in the harness: the person said it
          // themselves, so it is neither a model's draft nor a page's claim.
          trust: "trusted",
          idempotencyKey: toolEventIdempotencyKey("tool.completed", idempotencyKey),
        },
      );
      await append(
        "evidence.recorded",
        { capabilityId: capability.id, provenance: ASK_USER_PROVENANCE, summary: answeredSummary },
        { trust: "trusted" },
      );
      // No `recordUsage` debit and no `budget.recordToolCall`: this reached no
      // provider and committed no money, so charging it against the mission's
      // tool-call allowance would starve the research the answer is for.
      continue;
    }

    if (decision.replayExistingResult && reservation.storedResult !== undefined) {
      // The replayed append must be identical to the original success's
      // `tool.completed`: same key, same type, same payload, so that
      // `append_mission_event` returns the committed event (or commits it,
      // when the original run crashed between completing the reservation and
      // appending) instead of raising a 23505 conflict. A stored result that
      // predates the completion shape cannot rebuild that payload; it skips
      // the append entirely, because the original append already committed.
      const storedCompletion = readStoredToolCompletion(reservation.storedResult);
      if (storedCompletion) {
        await append(
          "tool.completed",
          {
            capabilityId: capability.id,
            summary: storedCompletion.summary,
            provenance: storedCompletion.provenance,
            output: storedCompletion.output,
          },
          {
            trust: storedCompletion.trust,
            idempotencyKey: toolEventIdempotencyKey("tool.completed", idempotencyKey),
          },
        );
      }
      continue;
    }

    await append(
      "tool.started",
      { capabilityId: capability.id },
      { idempotencyKey: toolEventIdempotencyKey("tool.started", idempotencyKey) },
    );

    let attempt = 0;
    let lastError: unknown;
    // Only the execution attempt itself lives inside this catch. A capability
    // that reached its provider must never run again because the bookkeeping
    // after it faltered: a non-idempotent write (a sent mail, a booked slot)
    // would land twice. Success is therefore captured here, the reservation
    // is completed immediately after the loop, and every later failure
    // propagates to the Inngest step, whose redelivery replays the stored
    // result instead of re-executing.
    let execution: StoredToolCompletion | undefined;
    while (execution === undefined) {
      try {
        if (capability.id.startsWith("cardea.web_")) {
          // One debit per (node, capability) per day window: a retried run
          // replays its reservation instead of double-counting, while a
          // genuinely new launch past the allowance is refused by the ledger.
          const window = utcDayWindow();
          try {
            const browserUsage = await persistence.recordUsage({
              tenantId: input.tenantId,
              missionId: input.missionId,
              nodeId: input.nodeId,
              // The ledger's uniqueness and summation are already tenant
              // scoped, so "provider"/"cloudflare-browser" reads as: this
              // tenant's daily draw on the browser provider.
              subjectKind: "provider",
              subjectId: "cloudflare-browser",
              metric: BROWSER_SESSION_METRIC,
              quantity: 1,
              costMicrounits: 0,
              limitQuantity: browserSessionDailyLimit(input.identityId ?? ""),
              limitCostMicrounits: Number.MAX_SAFE_INTEGER,
              windowStart: window.windowStart,
              windowEnd: window.windowEnd,
              idempotencyKey: `browser:${input.missionId}:${input.nodeId}:${capability.id}`.slice(0, 200),
              correlationId: input.correlationId,
            });
            await append("quota.consumed", {
              kind: "browser_sessions",
              used: browserUsage.totalQuantity,
              limit: browserSessionDailyLimit(input.identityId ?? ""),
              exhausted: false,
            });
          } catch (error) {
            if (isQuotaDenial(error)) {
              await emitBudgetExhausted(
                "browser_sessions",
                browserSessionDailyLimit(input.identityId ?? ""),
                browserSessionDailyLimit(input.identityId ?? ""),
              );
              return stop("budget_exhausted");
            }
            throw error;
          }
        }
        const result = await deps.registry.execute({
          capabilityId: capability.id,
          missionId: input.missionId,
          nodeId: input.nodeId,
          input: requestInput,
          correlationId: input.correlationId,
          idempotencyKey,
        });
        budget.recordToolCall();
        // An output past the byte bound is an execution-level failure, judged
        // before the reservation is marked succeeded.
        const boundedOutput = assertBoundedJson(result.output, "toolResult.output", MAX_TOOL_OUTPUT_BYTES);
        execution = {
          output: boundedOutput,
          summary: result.summary,
          provenance: result.provenance,
          trust: result.trust,
        };
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
    if (execution === undefined) {
      void lastError;
      continue;
    }
    // Completed before anything else so that a crash in the bookkeeping
    // below replays the stored result on redelivery instead of re-executing.
    await persistence.completeIdempotency({
      tenantId: input.tenantId,
      key: idempotencyKey,
      outcome: "succeeded",
      result: storedToolCompletion(execution),
    });
    await append(
      "tool.completed",
      { capabilityId: capability.id, summary: execution.summary, provenance: execution.provenance, output: execution.output },
      {
        trust: execution.trust,
        idempotencyKey: toolEventIdempotencyKey("tool.completed", idempotencyKey),
      },
    );
    await append(
      "evidence.recorded",
      { capabilityId: capability.id, provenance: execution.provenance, summary: execution.summary },
      { trust: execution.trust },
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
