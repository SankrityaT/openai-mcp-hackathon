// Note: no `import "server-only"` here (unlike other harness adapters). The
// `server-only` package is not an installed dependency in this repo — only
// Next.js's own bundler special-cases the bare specifier, so plain
// `node --test` (used by `pnpm test:harness`) cannot resolve it. This module
// is only ever invoked from Inngest functions and `/api/agent/plan`, both
// server-only execution contexts by construction, so the marker is
// redundant defense-in-depth here, not a correctness requirement.
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { CompiledContext, MissionPlan, PlanningInput } from "./contracts";
import { compilePlanningContext } from "./context-compiler";
import { routeModel, type ModelRoute } from "./model-router";

const nodeSchema = z.object({
  clientId: z.string().min(1).max(80),
  codename: z.string().min(1).max(80),
  roleLabel: z.string().min(1).max(120),
  objective: z.string().min(1).max(1_000),
  capabilityNames: z.array(z.string().min(1).max(160)).max(12),
  // Flat primitives only: this schema is converted to JSON Schema for the
  // model's structured output, and `z.custom` cannot be represented there
  // (it broke production planning outright). Capabilities needing nested
  // input must accept a JSON-encoded string.
  capabilityInputs: z
    .record(
      z.string().min(1).max(160),
      z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
  dependsOn: z.array(z.string().min(1).max(80)).max(20),
});

const planSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2_000),
  nodes: z.array(nodeSchema).min(1).max(12),
  approvalBoundaries: z.array(z.string().min(1).max(300)).max(20),
});

/**
 * Thrown when the planner cannot reach a model because `OPENAI_API_KEY` is
 * absent. Callers (the `planMission` Inngest function) must catch this and
 * append a visible mission failure/policy event instead of crashing — the
 * model may recommend, but its absence must degrade visibly, not silently.
 */
export class ModelNotConfiguredError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not configured; the mission planner is unavailable.");
    this.name = "ModelNotConfiguredError";
  }
}

export type PlanGenerationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type PlanGenerator = (args: {
  model: ModelRoute;
  context: CompiledContext;
}) => Promise<{ plan: MissionPlan; usage: PlanGenerationUsage }>;

async function defaultGenerate({
  model,
  context,
}: {
  model: ModelRoute;
  context: CompiledContext;
}): Promise<{ plan: MissionPlan; usage: PlanGenerationUsage }> {
  const result = await generateText({
    model: openai(model.modelId),
    system: context.system,
    prompt: context.prompt,
    output: Output.object({ schema: planSchema }),
    providerOptions: {
      openai: { reasoningEffort: model.reasoningEffort },
    },
  });
  return {
    plan: result.output,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}

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

export type PlannerDeps = {
  /** Injectable seam for tests: bypasses the OpenAI client and network entirely. */
  generate?: PlanGenerator;
};

export async function generateMissionPlan(
  input: PlanningInput,
  deps?: PlannerDeps,
): Promise<{
  plan: MissionPlan;
  model: ModelRoute;
  context: CompiledContext;
  usage: PlanGenerationUsage;
}> {
  const generate = deps?.generate ?? defaultGenerate;
  if (!deps?.generate && !process.env.OPENAI_API_KEY) {
    throw new ModelNotConfiguredError();
  }

  const context = compilePlanningContext(input);
  const model = routeModel(input.escalation);
  if (context.estimatedInputTokens > (input.budget?.maxInputTokens ?? 24_000)) {
    throw new Error("Compiled context exceeds the mission input-token budget");
  }

  const { plan, usage } = await generate({ model, context });
  validateDependencies(plan);
  return { plan, model, context, usage };
}
