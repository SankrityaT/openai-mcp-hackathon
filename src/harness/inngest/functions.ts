import { referenceFunction } from "inngest";
import { z } from "zod";
import type { Actor, AuthorityPolicy, BudgetLimits, JsonValue, MissionEvent } from "@/core/contracts/types";
import { runWithCorrelationId, withSpan } from "@/core/observability";
import { sendApprovalEmail } from "@/core/server/approval-email";
import { readEmailChannel } from "@/core/server/notification-channels";
import { createAdminMissionRepository } from "@/core/server/repository-factory";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";
import { notifyApprovalRequested } from "../approval-notification";
import { STANDING_SWEEP_CRON } from "@/core/policy/standing-cadence";
import { consumeUserMissionQuota } from "@/core/server/mission-quota";
import {
  claimStandingWindow,
  listDueStandingMissions,
  noteStandingRun,
} from "@/core/server/standing-mission-records";
import { ComposioCapabilityAdapter } from "../adapters/composio-capability";
import { internalFixtureAdapter } from "../adapters/internal-fixture";
import { retrieveMemoryForContext } from "../adapters/memory-retrieval";
import { CapabilityRegistry } from "../capability-registry";
import type { PlanningInput } from "../contracts";
import { deterministicUuid } from "../deterministic-id";
import {
  approvalEventIdempotencyKey,
  approvalRejectedPayload,
  runExecuteNode,
  type ExecuteNodeStatus,
} from "../execute-node";
import { generateMissionPlan, ModelNotConfiguredError } from "../planner";
import { RepositoryPersistence } from "../persistence/repository-persistence";
import { runStandingSweep, toStandingMissionDue } from "../standing-spawner";
import { inngest } from "./client";
import { sendMissionRequested, sendNodeRequested } from "./dispatch";

function buildRegistry(identityId: string): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(internalFixtureAdapter);
  registry.register(new ComposioCapabilityAdapter({ identityId }));
  return registry;
}

function summarizeAuthority(authority: AuthorityPolicy): string {
  const parts = [
    `freePassage=${authority.freePassage}`,
    `allowedCapabilities=${authority.allowedCapabilityIds.length}`,
    `allowedRiskLevels=${authority.allowedRiskLevels.join(",") || "none"}`,
    `maxAutonomousCostMicrounits=${authority.maxAutonomousCostMicrounits}`,
    `allowExternalSideEffects=${authority.allowExternalSideEffects}`,
    `requireApprovalCategories=${authority.requireApprovalCategories.join(",") || "none"}`,
    // Stated plainly so the planner can use these capabilities knowing every
    // one of them stops for the user's approval before it runs.
    `approvalGatedCapabilities=${authority.approvalGatedCapabilityIds?.join(",") || "none"}`,
  ];
  return parts.join("; ").slice(0, 4_000);
}

const actorSchema = z.object({
  kind: z.enum(["user", "cardea", "tool", "system"]),
  id: z.string().min(1).max(200),
});

// AuthorityPolicy / BudgetLimits / JsonValue are structurally validated
// elsewhere (src/core/contracts/validation.ts, applied at the HTTP boundary
// before dispatch). Event payloads crossing the Inngest transport are
// server-generated, not raw external input, so a lightweight custom check
// mirrors the existing convention in this file (see the prior
// `planningInputSchema`) rather than duplicating the full parser here.
const authoritySchema = z.custom<AuthorityPolicy>((value) => typeof value === "object" && value !== null);
const budgetSchema = z.custom<BudgetLimits>((value) => typeof value === "object" && value !== null);
const jsonValueSchema = z.custom<JsonValue>();

const nodePayloadSchema = z.object({
  clientId: z.string().min(1).max(80),
  codename: z.string().min(1).max(80),
  roleLabel: z.string().min(1).max(120),
  objective: z.string().min(1).max(1_000),
  capabilityNames: z.array(z.string().min(1).max(160)).max(12),
  capabilityInputs: z.record(z.string().min(1).max(160), jsonValueSchema).optional(),
  // Optional here, required in the planner's wire schema: events dispatched
  // before this field shipped are still in flight and must keep validating.
  // An absent estimate is coalesced to 0 at every read below.
  estimatedCostMicrounits: z.number().int().min(0).max(10_000_000_000).optional(),
});

const executeNodePayloadSchema = z.object({
  missionId: z.string().min(1),
  tenantId: z.string().min(1),
  identityId: z.string().min(1).max(200),
  nodeId: z.string().min(1),
  node: nodePayloadSchema,
  mandateVersion: z.number().int().min(1),
  expectedSequence: z.number().int().min(1),
  authority: authoritySchema,
  budgetLimits: budgetSchema,
  actor: actorSchema,
  correlationId: z.string().min(1),
});

const executeNodeReturnSchema = z.object({
  status: z.enum([
    "completed",
    "failed",
    "policy_denied",
    "approval_required",
    "waiting_for_connection",
    "budget_exhausted",
  ]),
  nextSequence: z.number(),
  emittedEventTypes: z.array(z.string()),
  approvalId: z.string().optional(),
});

export const executeNode = inngest.createFunction(
  {
    id: "cardea-execute-node",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: { event: "cardea/node.requested" },
  },
  async ({ event, step }) => {
    const data = executeNodePayloadSchema.parse(event.data);
    const result = await step.run("run-node", async () => logStep("run-node", data.correlationId, async () => {
      const repository = await createAdminMissionRepository();
      const persistence = new RepositoryPersistence(repository);
      const registry = buildRegistry(data.identityId);
      return runExecuteNode(
        {
          tenantId: data.tenantId,
          missionId: data.missionId,
          nodeId: data.nodeId,
          node: data.node,
          mandateVersion: data.mandateVersion,
          authority: data.authority,
          budgetLimits: data.budgetLimits,
          expectedSequence: data.expectedSequence,
          correlationId: data.correlationId,
          actor: data.actor,
        },
        { persistence, registry },
      );
    }));
    return result;
  },
);

const executeNodeReference = referenceFunction({
  functionId: "cardea-execute-node",
  schemas: {
    data: executeNodePayloadSchema,
    return: executeNodeReturnSchema,
  },
});

const missionRequestedSchema = z.object({
  missionId: z.string().min(1),
  tenantId: z.string().min(1),
  identityId: z.string().min(1).max(200),
  goal: z.string().min(1).max(8_000),
  constraints: z.array(jsonValueSchema).max(100),
  authority: authoritySchema,
  selectedContextCardIds: z.array(z.string()).max(100),
  budgetLimits: budgetSchema,
  mandateVersion: z.number().int().min(1),
  expectedSequence: z.number().int().min(1),
  actor: actorSchema,
  correlationId: z.string().min(1),
});

const MISSION_ACTOR: Actor = { kind: "cardea", id: "mission-planner" };
const MAX_PARALLEL_NODES = 5;

/**
 * Redacted operational breadcrumbs: Inngest step failures otherwise surface
 * in hosting logs only as "Inngest step error", which made a production
 * planning outage undiagnosable. Never logs payloads or credentials.
 */
function logRedactedStepError(stepName: string, error: unknown): void {
  const detail = error as { name?: string; statusCode?: number; code?: string; message?: string };
  console.error(
    "planmission_step_error",
    stepName,
    detail?.name ?? "unknown",
    detail?.statusCode ?? "",
    detail?.code ?? "",
    String(detail?.message ?? "").slice(0, 300),
  );
}

/**
 * Inngest step boundary tracing + failure breadcrumbs. Extends the original
 * `logStepFailure` pattern: it still emits the redacted step-error breadcrumb,
 * but now (a) establishes the mission's correlation id for the whole step so
 * every nested span (model call, policy decision, capability discover/execute)
 * links to the same trace, and (b) emits one redacted span per step covering
 * both success and failure. Span emission and the breadcrumb never throw into
 * the mission path; only the wrapped work's own error propagates.
 */
function logStep<T>(stepName: string, correlationId: string, run: () => Promise<T>): Promise<T> {
  return runWithCorrelationId(correlationId, () =>
    withSpan("inngest.step", { stepName }, async (span) => {
      try {
        const result = await run();
        span.set({ resultStatus: "succeeded" });
        return result;
      } catch (error) {
        span.set({ resultStatus: "failed" });
        logRedactedStepError(stepName, error);
        throw error;
      }
    }),
  );
}

export const planMission = inngest.createFunction(
  {
    id: "cardea-plan-mission",
    retries: 2,
    triggers: { event: "cardea/mission.requested" },
  },
  async ({ event, step }) => {
    const data = missionRequestedSchema.parse(event.data);

    const capabilities = await step.run("discover-capabilities", () =>
      logStep("discover-capabilities", data.correlationId, () =>
        buildRegistry(data.identityId).discover(),
      ),
    );
    const memory = await step.run("retrieve-memory", () =>
      logStep("retrieve-memory", data.correlationId, () =>
        retrieveMemoryForContext({
          userId: data.identityId,
          query: data.goal,
          selectedContextCardIds: data.selectedContextCardIds,
        }),
      ),
    );

    const planningInput: PlanningInput = {
      goal: data.goal,
      constraints: data.constraints,
      authoritySummary: summarizeAuthority(data.authority),
      capabilities,
      memories: memory.items,
      selectedContextCardIds: data.selectedContextCardIds,
      budget: data.budgetLimits,
    };

    // The `instanceof` check must run inside the same step attempt that
    // calls the planner: Inngest step results are serialized across
    // checkpoint boundaries, so class identity is not guaranteed to survive
    // a retry if the check happened outside step.run.
    const planningOutcome = await step.run("generate-plan", () =>
      logStep("generate-plan", data.correlationId, async () => {
        try {
          const planning = await generateMissionPlan(planningInput);
          return { ok: true as const, planning };
        } catch (error) {
          if (error instanceof ModelNotConfiguredError) {
            // A configuration gap, not a step failure: return a handled outcome
            // (the step span records success) rather than throwing.
            return { ok: false as const, reason: "model_not_configured" as const };
          }
          // logStep emits the redacted breadcrumb + failed span before rethrow.
          throw error;
        }
      }),
    );

    if (!planningOutcome.ok) {
      await step.run("append-mission-not-configured", async () => {
        const repository = await createAdminMissionRepository();
        const persistence = new RepositoryPersistence(repository);
        return persistence.appendEvent({
          missionId: data.missionId,
          expectedSequence: data.expectedSequence,
          type: "mission.failed",
          actor: { kind: "system", id: "mission-harness" },
          correlationId: data.correlationId,
          idempotencyKey: `event:${data.missionId}:mission.failed:${data.expectedSequence}`,
          payload: { reason: planningOutcome.reason },
          trust: "derived",
          // `p_mission_status` is what actually flips `missions.status` —
          // the event payload alone never does this (see
          // supabase/migrations/20260826000200_transactions_and_guards.sql).
          materialization: { missionStatus: "failed" },
        });
      });
      return { status: "mission_failed" as const, reason: planningOutcome.reason };
    }

    const { plan } = planningOutcome.planning;

    const persisted = await step.run("persist-plan", async () => logStep("persist-plan", data.correlationId, async () => {
      const repository = await createAdminMissionRepository();
      const persistence = new RepositoryPersistence(repository);
      let sequence = data.expectedSequence;

      // `append_mission_event` requires a real uuid `p_node_id` for
      // `node.planned` and validates `payload.node.id === p_node_id`
      // (see supabase/migrations/20260826000200_transactions_and_guards.sql).
      // The planner's `clientId` is a short human-readable label, not a
      // uuid, so every planned node gets a freshly generated id here; the
      // clientId -> nodeId map is what lets `dependency.added` translate
      // `dependsOn` client ids into the real node ids the edge table
      // requires, and what lets each node worker invocation below carry the
      // same id the materialized `mission_nodes` row was created with.
      const nodeIds = new Map<string, string>(
        plan.nodes.map((node) => [
          node.clientId,
          deterministicUuid(
            "node",
            data.missionId,
            `mandate:${data.mandateVersion}`,
            node.clientId,
          ),
        ]),
      );

      async function append(
        type: "mandate.proposed" | "node.planned" | "dependency.added",
        payload: JsonValue,
        nodeId: string | undefined,
        idempotencySuffix: string,
      ) {
        const event = await persistence.appendEvent({
          missionId: data.missionId,
          nodeId,
          expectedSequence: sequence,
          type,
          actor: MISSION_ACTOR,
          correlationId: data.correlationId,
          idempotencyKey: `event:${data.missionId}:${type}:${idempotencySuffix}`,
          payload,
          trust: "derived",
        });
        sequence = event.sequence;
      }

      // `mandate.proposed` does not materialize (see
      // src/core/events/catalogue.ts) and has no RPC-enforced payload shape.
      // This implementation uses it to carry the generated plan artifact
      // (title/summary/approval boundaries) as Cardea's proposed addition to
      // the mandate — there is no more specific catalogued event for "a plan
      // was generated". Flagged for the realtime/UI team in the handoff.
      await append(
        "mandate.proposed",
        {
          title: plan.title,
          summary: plan.summary,
          approvalBoundaries: plan.approvalBoundaries,
          memory: {
            available: memory.available,
            includedIds: planningOutcome.planning.context.includedMemoryIds,
          },
        },
        undefined,
        `mandate:v2:${data.mandateVersion}`,
      );

      for (const node of plan.nodes) {
        const nodeId = nodeIds.get(node.clientId);
        if (!nodeId) continue;
        await append(
          "node.planned",
          {
            node: {
              id: nodeId,
              parentId: null,
              codename: node.codename,
              roleLabel: node.roleLabel,
              objective: node.objective,
              status: "planned",
              requiredCapabilities: node.capabilityNames.map((name) => ({
                name,
                ...(node.capabilityInputs?.[name] !== undefined
                  ? { constraints: node.capabilityInputs[name] }
                  : {}),
              })),
              inputRefs: [],
              outputRefs: [],
              budgetLimits: {},
            },
            clientId: node.clientId,
            // Recorded alongside `clientId` (not inside `node`, whose shape the
            // materializing RPC owns) so an approval resume can recover the
            // planner's estimate from the log instead of guessing it. The
            // idempotency key moves to v4 because the payload changed:
            // `append_mission_event` rejects a reused key with a different
            // payload rather than replaying it.
            estimatedCostMicrounits: node.estimatedCostMicrounits ?? 0,
          },
          nodeId,
          `node:v4:${data.mandateVersion}:${node.clientId}`,
        );
      }

      for (const node of plan.nodes) {
        const toNodeId = nodeIds.get(node.clientId);
        if (!toNodeId) continue;
        for (const dependency of node.dependsOn) {
          const fromNodeId = nodeIds.get(dependency);
          if (!fromNodeId) continue;
          await append(
            "dependency.added",
            {
              edge: {
                id: deterministicUuid(
                  "edge",
                  data.missionId,
                  `mandate:${data.mandateVersion}`,
                  dependency,
                  node.clientId,
                ),
                fromNodeId,
                toNodeId,
                kind: "depends_on",
                condition: null,
              },
            },
            toNodeId,
            `dep:v3:${data.mandateVersion}:${dependency}-${node.clientId}`,
          );
        }
      }

      return { nextSequence: sequence, nodeIds: Object.fromEntries(nodeIds) };
    }));

    // Execution honors the dependency graph in waves: a node runs only once
    // every prerequisite completed, and each completion unlocks the next
    // wave. A node whose prerequisite pauses, fails, or stops at an approval
    // is left planned, which the board reads honestly as blocked.
    type NodeInvocationResult = {
      status: ExecuteNodeStatus;
      nextSequence: number;
      emittedEventTypes: string[];
      approvalId?: string;
    };
    const buildNodeData = (node: (typeof plan.nodes)[number], expectedSequence: number) => ({
      missionId: data.missionId,
      tenantId: data.tenantId,
      identityId: data.identityId,
      nodeId: persisted.nodeIds[node.clientId],
      node: {
        clientId: node.clientId,
        codename: node.codename,
        roleLabel: node.roleLabel,
        objective: node.objective,
        capabilityNames: node.capabilityNames,
        capabilityInputs: node.capabilityInputs,
        estimatedCostMicrounits: node.estimatedCostMicrounits ?? 0,
      },
      mandateVersion: data.mandateVersion,
      expectedSequence,
      authority: data.authority,
      budgetLimits: data.budgetLimits,
      actor: MISSION_ACTOR,
      correlationId: data.correlationId,
    });

    const statusByClientId = new Map<string, ExecuteNodeStatus>();
    const allResults: NodeInvocationResult[] = [];
    let cursorSequence = persisted.nextSequence;
    let wave = 0;
    for (;;) {
      const runnable = plan.nodes.filter(
        (node) =>
          !statusByClientId.has(node.clientId) &&
          node.dependsOn.every((dep) => statusByClientId.get(dep) === "completed"),
      );
      if (runnable.length === 0) break;
      const batch = runnable.slice(0, MAX_PARALLEL_NODES);
      const results = (await Promise.all(
        batch.map((node) =>
          step.invoke(`execute-w${wave}-${node.clientId}`, {
            function: executeNodeReference,
            data: buildNodeData(node, cursorSequence),
            timeout: "10m",
          }),
        ),
      )) as NodeInvocationResult[];
      batch.forEach((node, index) => {
        statusByClientId.set(node.clientId, results[index]?.status ?? "failed");
      });
      allResults.push(...results);
      cursorSequence = Math.max(cursorSequence, ...results.map((r) => r?.nextSequence ?? 0));
      wave += 1;
    }

    return {
      status: "planned" as const,
      planning: planningOutcome.planning,
      nodes: allResults,
    };
  },
);

const approvalResolvedSchema = z.object({
  approvalId: z.string().min(1),
  missionId: z.string().min(1),
  decision: z.enum(["accepted", "modified", "rejected"]),
  actor: actorSchema,
  correlationId: z.string().min(1),
});

/**
 * Locates the `approval.requested` event that created an approval. It is the
 * only place that ties an approval id back to the node it paused (the
 * materialized `mission_approvals` row leaves the snapshot's
 * `pendingApprovals` the moment it is resolved) and it carries the mandate
 * version the approval was requested under.
 */
function findApprovalRequest(
  events: MissionEvent[],
  approvalId: string,
): { nodeId: string; mandateVersion?: number } | undefined {
  for (const event of events) {
    if (event.type !== "approval.requested" || !event.nodeId) continue;
    const payload = event.payload as { approval?: { id?: unknown; mandateVersion?: unknown } };
    const approval = payload && typeof payload === "object" ? payload.approval : undefined;
    if (!approval || approval.id !== approvalId) continue;
    return {
      nodeId: event.nodeId,
      mandateVersion: typeof approval.mandateVersion === "number" ? approval.mandateVersion : undefined,
    };
  }
  return undefined;
}

/**
 * The planner's short human-readable node label lives only in the
 * `node.planned` payload, not on the materialized node row. It is cosmetic
 * for a resumed run, so the codename is an acceptable fallback.
 */
function findPlannedClientId(events: MissionEvent[], nodeId: string): string | undefined {
  for (const event of events) {
    if (event.type !== "node.planned" || event.nodeId !== nodeId) continue;
    const payload = event.payload as { clientId?: unknown };
    if (payload && typeof payload === "object" && typeof payload.clientId === "string") {
      return payload.clientId;
    }
  }
  return undefined;
}

/**
 * Reads the planner's micro-USD estimate back out of a node's `node.planned`
 * event. Returns undefined for a node planned before the field existed, which
 * the caller reads as 0 — an old plan claimed no spend, and inventing one here
 * would gate a step on a number nobody produced.
 */
function findPlannedCostEstimate(events: MissionEvent[], nodeId: string): number | undefined {
  for (const event of events) {
    if (event.type !== "node.planned" || event.nodeId !== nodeId) continue;
    const payload = event.payload as { estimatedCostMicrounits?: unknown };
    if (
      payload &&
      typeof payload === "object" &&
      typeof payload.estimatedCostMicrounits === "number" &&
      Number.isFinite(payload.estimatedCostMicrounits) &&
      payload.estimatedCostMicrounits >= 0
    ) {
      return payload.estimatedCostMicrounits;
    }
  }
  return undefined;
}

/**
 * Resumes a node that `runExecuteNode` paused at a `require_approval` gate.
 *
 * Triggered directly by `cardea/approval.resolved` — the event
 * `POST /api/approvals/:approvalId/resolve` already sends — so there is no
 * suspended wait step to keep alive. On an accepted or modified decision it
 * re-dispatches `cardea/node.requested` for the paused node; the resumed run
 * re-reaches the same gate, reads the now-settled approval row back out of
 * the idempotent `request_mission_approval` RPC, and executes instead of
 * pausing again (see `runExecuteNode`). On a rejection it fails the node here.
 *
 * No `approval.resolved` event is appended: the resolve RPC already appended
 * exactly one as part of the atomic resolution.
 *
 * The replaced `waitForApproval` function owned a 7-day expiry append. That
 * branch was unreachable — it triggered on `cardea/approval.requested`, which
 * nothing has ever sent — so nothing working is lost here; approval expiry
 * still needs the `expire_mission_approval` RPC noted as a BE-01 follow-up.
 */
export const resumeApprovedNode = inngest.createFunction(
  {
    id: "cardea-resume-approved-node",
    retries: 2,
    triggers: { event: "cardea/approval.resolved" },
  },
  async ({ event, step }) => {
    const data = approvalResolvedSchema.parse(event.data);
    const outcome = await step.run("resume-node", () =>
      logStep("resume-node", data.correlationId, async () => {
        const repository = await createAdminMissionRepository();
        const snapshot = await repository.getMission(data.missionId);
        if (!snapshot) return { status: "mission_not_found" as const };
        const events = await repository.listEvents(data.missionId);
        const request = findApprovalRequest(events, data.approvalId);
        if (!request) return { status: "approval_request_not_found" as const };
        const node = snapshot.nodes.find((candidate) => candidate.id === request.nodeId);
        if (!node) return { status: "node_not_found" as const };

        const persistence = new RepositoryPersistence(repository);
        if (data.decision === "rejected") {
          await persistence.appendEvent({
            missionId: data.missionId,
            nodeId: node.id,
            expectedSequence: snapshot.latestSequence,
            type: "node.failed",
            actor: MISSION_ACTOR,
            correlationId: data.correlationId,
            // Approval-id keyed, with the payload built by the same helper the
            // node run uses: a redelivered resolution — or a redelivered node
            // run reaching the same settled gate — replays this exact event
            // instead of appending a second failure.
            idempotencyKey: approvalEventIdempotencyKey(data.missionId, node.id, "node.failed", data.approvalId),
            payload: approvalRejectedPayload(node.id, data.approvalId, "approval_rejected"),
            trust: "derived",
            materialization: { nodeStatus: "failed" },
          });
          return { status: "node_failed" as const, nodeId: node.id };
        }

        // The mandate version must be the one the approval was requested
        // under: it feeds `buildIdempotencyKey`, and the resumed run only
        // finds that settled approval again if the derived key is identical.
        const mandateVersion = request.mandateVersion ?? snapshot.mandate.version;
        const dispatch = await sendNodeRequested({
          missionId: data.missionId,
          tenantId: snapshot.mission.tenantId,
          // Mirrors `resolveMissionWriteContext`: an authenticated resolver's
          // actor id is the Cardea identity, while guest and judge sessions
          // resolve as a system actor scoped to the tenant.
          identityId: data.actor.kind === "user" ? data.actor.id : snapshot.mission.tenantId,
          nodeId: node.id,
          node: {
            clientId: findPlannedClientId(events, node.id) ?? node.codename,
            codename: node.codename,
            roleLabel: node.roleLabel,
            objective: node.objective,
            capabilityNames: node.requiredCapabilities.map((capability) => capability.name),
            capabilityInputs: Object.fromEntries(
              node.requiredCapabilities
                .filter((capability) => capability.constraints !== undefined)
                .map((capability) => [capability.name, capability.constraints as JsonValue]),
            ),
            // Recovered from the node's own `node.planned` event: the resumed
            // run must gate against the same estimate the original dispatch
            // carried, and the reservation it makes is keyed per (mission,
            // node, mandate version) so resuming never double-reserves.
            estimatedCostMicrounits: findPlannedCostEstimate(events, node.id) ?? 0,
          },
          mandateVersion,
          expectedSequence: snapshot.latestSequence,
          authority: snapshot.mandate.authority,
          budgetLimits: snapshot.mission.budgetLimits,
          actor: MISSION_ACTOR,
          correlationId: data.correlationId,
          resumeOfApprovalId: data.approvalId,
        });
        return { status: "node_resumed" as const, nodeId: node.id, dispatch };
      }),
    );
    return { approvalId: data.approvalId, decision: data.decision, ...outcome };
  },
);

const approvalNotifySchema = z.object({
  approvalId: z.string().min(1),
  missionId: z.string().min(1),
  tenantId: z.string().min(1),
  recommendation: z.string().max(4_000).default(""),
  consequence: z.string().max(4_000).default(""),
  category: z.string().max(80).default(""),
  codename: z.string().max(120).default(""),
});

/**
 * Reach-me approvals: emails the mission's owner the decision that stopped
 * the run, once the pause is already durable.
 *
 * Everything this function can fail to find is a quiet, named exit rather
 * than an error: a guest or judge tenant has no owner, an owner who never
 * opted in has no channel, and a deployment without `RESEND_API_KEY` has no
 * transport. None of those are mission failures — the mission paused
 * correctly and the board still shows the approval — so none of them retry
 * and none of them log an address.
 */
export const notifyApproval = inngest.createFunction(
  {
    id: "cardea-notify-approval",
    // A notification is worth one retry for a transient blip and no more; the
    // sender already retries the HTTP call once itself.
    retries: 1,
    triggers: { event: "cardea/approval.notify" },
  },
  async ({ event, step }) => {
    const data = approvalNotifySchema.parse(event.data);
    return step.run("notify-approval", async () => {
      if (!hasSupabaseSecretKey()) return { status: "not_configured" as const };
      const admin = createSupabaseAdminClient();
      return notifyApprovalRequested(data, {
        resolveOwnerUserId: async (tenantId) => {
          const { data: tenant, error } = await admin
            .from("tenants")
            .select("owner_user_id")
            .eq("id", tenantId)
            .maybeSingle();
          if (error || !tenant) return null;
          return tenant.owner_user_id;
        },
        isEmailChannelEnabled: async (userId) =>
          (await readEmailChannel(admin, userId))?.enabled === true,
        resolveOwnerEmail: async (userId) => {
          // The address is never copied into Cardea's own tables: it is read
          // from the account at send time and discarded with this closure.
          const { data: result, error } = await admin.auth.admin.getUserById(userId);
          if (error) return null;
          const email = result?.user?.email;
          return typeof email === "string" && email.length > 0 ? email : null;
        },
        send: sendApprovalEmail,
        appOrigin: process.env.CARDEA_APP_ORIGIN ?? "",
      });
    });
  },
);

/**
 * The standing-mission sweep.
 *
 * Runs every 30 minutes and asks one question: which standing missions have a
 * live, unclaimed window right now? For each, it claims the window, charges
 * the owner's own daily mission allowance, opens an ordinary mission carrying
 * a verbatim copy of the authority they approved, marks that mandate approved
 * — the standing mandate *is* the standing approval, given once by the human
 * who created it — and dispatches planning the same way the events route does
 * when someone approves a mandate by hand.
 *
 * Nothing about being on a schedule widens what a run may do. The spawned
 * mission is an ordinary mission: every node-level hard stop and approval gate
 * fires on every run, exactly as it would for a mission opened by hand.
 *
 * Double-spawn is prevented at two independent layers. First,
 * `claimStandingWindow` is a compare-and-set on the standing row, and Postgres
 * serialises concurrent updates to a row, so two racing sweeps produce exactly
 * one claim. Second, the correlation id is derived from `standing:<id>:<window>`,
 * so the quota debit for a window always lands on the same
 * `mission-create:<correlationId>` idempotency key, which `usage_ledger` holds
 * unique per `(tenant, subject_kind, subject_id, metric, idempotency_key)`, and
 * the `mandate.approved` append always lands on the same per-mission
 * idempotency key that `append_mission_event` replays rather than duplicates.
 *
 * The whole sweep runs inside one `step.run`, so an Inngest retry re-runs it
 * as a unit and the claim is what decides whether anything happens the second
 * time.
 */
export const standingSpawner = inngest.createFunction(
  {
    id: "cardea-standing-spawner",
    retries: 1,
    triggers: { cron: STANDING_SWEEP_CRON },
  },
  async ({ step }) => {
    const now = new Date();
    const correlationId = deterministicUuid("standing-sweep", now.toISOString());
    return step.run("sweep-standing-missions", () =>
      logStep("sweep-standing-missions", correlationId, async () => {
        const admin = createSupabaseAdminClient();
        const repository = createAdminMissionRepository();
        return runStandingSweep(
          {
            listDue: async (at) =>
              (await listDueStandingMissions(admin, at)).map(toStandingMissionDue),
            claimWindow: async (input) =>
              (await claimStandingWindow(admin, input)) !== null,
            recordRun: (input) => noteStandingRun(admin, input),
            consumeQuota: (input) => consumeUserMissionQuota(repository, input),
            createMission: async (input) => {
              const snapshot = await repository.createMission({
                tenantId: input.tenantId,
                title: input.title,
                goal: input.goal,
                constraints: input.constraints,
                authority: input.authority as unknown as JsonValue,
                selectedContextCardIds: input.selectedContextCardIds,
                budgetLimits: input.budgetLimits as unknown as JsonValue,
                correlationId: input.correlationId,
                actor: input.actor,
              });
              return {
                missionId: snapshot.mission.id,
                tenantId: snapshot.mission.tenantId,
                mandateVersion: snapshot.mandate.version,
                latestSequence: snapshot.latestSequence,
              };
            },
            approveMandate: async (input) => {
              const appended = await repository.appendEvent({
                missionId: input.missionId,
                expectedSequence: input.expectedSequence,
                type: "mandate.approved",
                actor: input.actor,
                correlationId: input.correlationId,
                idempotencyKey: input.idempotencyKey,
                payload: { version: input.mandateVersion },
                trust: "trusted",
              });
              return { sequence: appended.sequence };
            },
            dispatchPlanning: (input) => sendMissionRequested(input),
          },
          now,
        );
      }),
    );
  },
);

export const cardeaFunctions = [
  executeNode,
  planMission,
  resumeApprovedNode,
  notifyApproval,
  standingSpawner,
];
