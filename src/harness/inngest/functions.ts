import { randomUUID } from "node:crypto";
import { referenceFunction } from "inngest";
import { z } from "zod";
import type { Actor, AuthorityPolicy, BudgetLimits, JsonValue } from "@/core/contracts/types";
import { createAdminMissionRepository } from "@/core/server/repository-factory";
import { ComposioCapabilityAdapter } from "../adapters/composio-capability";
import { internalFixtureAdapter } from "../adapters/internal-fixture";
import { retrieveMemoryForContext } from "../adapters/memory-retrieval";
import { CapabilityRegistry } from "../capability-registry";
import type { PlanningInput } from "../contracts";
import { runExecuteNode, type ExecuteNodeStatus } from "../execute-node";
import { generateMissionPlan, ModelNotConfiguredError } from "../planner";
import { RepositoryPersistence } from "../persistence/repository-persistence";
import { inngest } from "./client";

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
    const result = await step.run("run-node", async () => {
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
    });
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

export const planMission = inngest.createFunction(
  {
    id: "cardea-plan-mission",
    retries: 2,
    triggers: { event: "cardea/mission.requested" },
  },
  async ({ event, step }) => {
    const data = missionRequestedSchema.parse(event.data);

    const capabilities = await step.run("discover-capabilities", () =>
      buildRegistry(data.identityId).discover(),
    );
    const memory = await step.run("retrieve-memory", () =>
      retrieveMemoryForContext({
        userId: data.identityId,
        query: data.goal,
        selectedContextCardIds: data.selectedContextCardIds,
      }),
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
    const planningOutcome = await step.run("generate-plan", async () => {
      try {
        const planning = await generateMissionPlan(planningInput);
        return { ok: true as const, planning };
      } catch (error) {
        if (error instanceof ModelNotConfiguredError) {
          return { ok: false as const, reason: "model_not_configured" as const };
        }
        throw error;
      }
    });

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

    const persisted = await step.run("persist-plan", async () => {
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
      const nodeIds = new Map<string, string>(plan.nodes.map((node) => [node.clientId, randomUUID()]));

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
        sequence = event.sequence + 1;
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
        "mandate",
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
              requiredCapabilities: node.capabilityNames.map((name) => ({ name })),
              inputRefs: [],
              outputRefs: [],
              budgetLimits: {},
            },
            clientId: node.clientId,
          },
          nodeId,
          `node:${node.clientId}`,
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
                id: randomUUID(),
                fromNodeId,
                toNodeId,
                kind: "depends_on",
                condition: null,
              },
            },
            toNodeId,
            `dep:${dependency}-${node.clientId}`,
          );
        }
      }

      return { nextSequence: sequence, nodeIds: Object.fromEntries(nodeIds) };
    });

    const nodesToRun = plan.nodes.slice(0, MAX_PARALLEL_NODES);
    const invocations = await Promise.all(
      nodesToRun.map((node) =>
        step.invoke(`execute-${node.clientId}`, {
          function: executeNodeReference,
          data: {
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
            },
            mandateVersion: data.mandateVersion,
            expectedSequence: persisted.nextSequence,
            authority: data.authority,
            budgetLimits: data.budgetLimits,
            actor: MISSION_ACTOR,
            correlationId: data.correlationId,
          },
          timeout: "10m",
        }),
      ),
    );

    return {
      status: "planned" as const,
      planning: planningOutcome.planning,
      nodes: invocations as Array<{ status: ExecuteNodeStatus; nextSequence: number; emittedEventTypes: string[]; approvalId?: string }>,
    };
  },
);

const approvalResolvedSchema = z.object({
  approvalId: z.string().min(1),
  missionId: z.string().min(1),
  decision: z.enum(["accepted", "modified", "rejected"]),
});

export const waitForApproval = inngest.createFunction(
  {
    id: "cardea-wait-for-approval",
    retries: 1,
    triggers: { event: "cardea/approval.requested" },
  },
  async ({ event, step }) => {
    const data = z.object({ approvalId: z.string(), missionId: z.string() }).parse(event.data);
    const resolution = await step.waitForEvent("wait-for-resolution", {
      event: "cardea/approval.resolved",
      timeout: "7d",
      if: `async.data.approvalId == "${data.approvalId}"`,
    });

    if (!resolution) {
      // Known limitation: `AppendMissionEventCommand.materialization` only
      // carries mission/node fields today, not an approval-status field, and
      // there is no `expire_mission_approval` RPC alongside
      // `resolve_mission_approval`. This makes the expiry durably visible in
      // the event log, but the materialized `mission_approvals` row is not
      // flipped to "expired" by this call alone — that needs a dedicated
      // repository/RPC addition (BE-01 scope), tracked as a follow-up.
      await step.run("append-approval-expired", async () => {
        const repository = await createAdminMissionRepository();
        const persistence = new RepositoryPersistence(repository);
        const snapshot = await repository.getMission(data.missionId);
        const expectedSequence = (snapshot?.latestSequence ?? 0) + 1;
        return persistence.appendEvent({
          missionId: data.missionId,
          expectedSequence,
          type: "approval.expired",
          actor: { kind: "system", id: "mission-harness" },
          correlationId: data.approvalId,
          idempotencyKey: `event:${data.missionId}:approval.expired:${data.approvalId}`,
          payload: { approvalId: data.approvalId },
          trust: "derived",
        });
      });
      return { approvalId: data.approvalId, resolution: null };
    }

    const resolved = approvalResolvedSchema.parse(resolution.data);

    // No event append here: `POST /api/approvals/:approvalId/resolve` already
    // durably appends exactly one `approval.resolved` event as part of the
    // atomic `resolve_mission_approval` RPC (see docs/CORE_DATA_POLICY.md).
    // `cardea/approval.resolved` is purely the wake-up signal for this
    // suspended step; appending a second event here would duplicate it.
    //
    // Returning the decision lets a suspended node worker resume: a future
    // node-level redirect can trigger `cardea/node.requested` again for the
    // paused node once the caller inspects this decision. Full automatic
    // node resumption (re-invoking `executeNode` for the same node without
    // a fresh planning pass) is not wired in this pass — see handoff notes.
    return { approvalId: data.approvalId, resolution: resolved };
  },
);

export const cardeaFunctions = [executeNode, planMission, waitForApproval];
