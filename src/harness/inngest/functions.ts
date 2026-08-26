import { referenceFunction } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { generateMissionPlan } from "../planner";
import type { PlanningInput } from "../contracts";

const planningInputSchema = z.custom<PlanningInput>();

export const executeNode = inngest.createFunction(
  {
    id: "cardea-execute-node",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: { event: "cardea/node.requested" },
  },
  async ({ event, step }) => {
    const payload = z
      .object({
        missionId: z.string().min(1),
        node: z.object({
          clientId: z.string(),
          roleLabel: z.string(),
          objective: z.string(),
          capabilityNames: z.array(z.string()),
        }),
      })
      .parse(event.data);
    return step.run("prepare-node-result", () => ({
      missionId: payload.missionId,
      nodeId: payload.node.clientId,
      status: "prepared" as const,
      summary: `${payload.node.roleLabel} is ready for capability execution.`,
      capabilityNames: payload.node.capabilityNames,
    }));
  },
);

const executeNodeReference = referenceFunction({
  functionId: "cardea-execute-node",
  schemas: {
    data: z.object({
      missionId: z.string(),
      node: z.object({
        clientId: z.string(),
        roleLabel: z.string(),
        objective: z.string(),
        capabilityNames: z.array(z.string()),
      }),
    }),
    return: z.object({
      missionId: z.string(),
      nodeId: z.string(),
      status: z.literal("prepared"),
      summary: z.string(),
      capabilityNames: z.array(z.string()),
    }),
  },
});

export const planMission = inngest.createFunction(
  {
    id: "cardea-plan-mission",
    retries: 2,
    triggers: { event: "cardea/mission.requested" },
  },
  async ({ event, step }) => {
    const data = z
      .object({ missionId: z.string().min(1), input: planningInputSchema })
      .parse(event.data);
    const planning = await step.run("generate-plan", () => generateMissionPlan(data.input));
    const nodes = await Promise.all(
      planning.plan.nodes.slice(0, 5).map((node) =>
        step.invoke(`prepare-${node.clientId}`, {
          function: executeNodeReference,
          data: {
            missionId: data.missionId,
            node: {
              clientId: node.clientId,
              roleLabel: node.roleLabel,
              objective: node.objective,
              capabilityNames: node.capabilityNames,
            },
          },
          timeout: "10m",
        }),
      ),
    );
    return { planning, nodes };
  },
);

export const waitForApproval = inngest.createFunction(
  {
    id: "cardea-wait-for-approval",
    retries: 1,
    triggers: { event: "cardea/approval.requested" },
  },
  async ({ event, step }) => {
    const data = z
      .object({ approvalId: z.string(), missionId: z.string() })
      .parse(event.data);
    const resolution = await step.waitForEvent("wait-for-resolution", {
      event: "cardea/approval.resolved",
      timeout: "7d",
      if: `async.data.approvalId == "${data.approvalId}"`,
    });
    return { approvalId: data.approvalId, resolution: resolution?.data ?? null };
  },
);

export const cardeaFunctions = [executeNode, planMission, waitForApproval];
