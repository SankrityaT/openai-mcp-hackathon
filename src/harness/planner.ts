import "server-only";

import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { MissionPlan, PlanningInput } from "./contracts";
import { compilePlanningContext } from "./context-compiler";
import { routeModel } from "./model-router";

const nodeSchema = z.object({
  clientId: z.string().min(1).max(80),
  codename: z.string().min(1).max(80),
  roleLabel: z.string().min(1).max(120),
  objective: z.string().min(1).max(1_000),
  capabilityNames: z.array(z.string().min(1).max(160)).max(12),
  dependsOn: z.array(z.string().min(1).max(80)).max(20),
});

const planSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2_000),
  nodes: z.array(nodeSchema).min(1).max(12),
  approvalBoundaries: z.array(z.string().min(1).max(300)).max(20),
});

function validateDependencies(plan: MissionPlan) {
  const ids = new Set(plan.nodes.map((node) => node.clientId));
  if (ids.size !== plan.nodes.length) throw new Error("Plan contains duplicate node ids");
  for (const node of plan.nodes) {
    if (node.dependsOn.includes(node.clientId)) throw new Error("Plan contains a self dependency");
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) throw new Error("Plan references an unknown dependency");
    }
  }
}

export async function generateMissionPlan(input: PlanningInput): Promise<{
  plan: MissionPlan;
  model: ReturnType<typeof routeModel>;
  context: ReturnType<typeof compilePlanningContext>;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}> {
  const context = compilePlanningContext(input);
  const model = routeModel(input.escalation);
  if (context.estimatedInputTokens > (input.budget?.maxInputTokens ?? 24_000)) {
    throw new Error("Compiled context exceeds the mission input-token budget");
  }

  const result = await generateText({
    model: openai(model.modelId),
    system: context.system,
    prompt: context.prompt,
    output: Output.object({ schema: planSchema }),
    providerOptions: {
      openai: { reasoningEffort: model.reasoningEffort },
    },
  });
  const plan = result.output;
  validateDependencies(plan);
  return {
    plan,
    model,
    context,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}
