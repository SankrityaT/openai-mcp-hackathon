import assert from "node:assert/strict";
import test from "node:test";
import type { MissionPlan, PlanningInput } from "./contracts";
import { ModelNotConfiguredError, generateMissionPlan } from "./planner";

const BASE_INPUT: PlanningInput = {
  goal: "Coordinate a generic relocation",
  constraints: [],
  authoritySummary: "Read-only research only",
  capabilities: [],
  selectedContextCardIds: [],
};

test("throws a typed ModelNotConfiguredError instead of crashing when OPENAI_API_KEY is absent", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => generateMissionPlan(BASE_INPUT),
      (error: unknown) => error instanceof ModelNotConfiguredError,
    );
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("an injected generator seam bypasses the model client entirely (no network call)", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const fakePlan: MissionPlan = {
      title: "Fixture plan",
      summary: "Deterministic fixture plan for tests",
      nodes: [
        {
          clientId: "n1",
          codename: "scout",
          roleLabel: "Scout",
          objective: "Gather fixture evidence",
          capabilityNames: ["internal.echo_research"],
          dependsOn: [],
        },
      ],
      approvalBoundaries: [],
    };
    const result = await generateMissionPlan(BASE_INPUT, {
      generate: async () => ({ plan: fakePlan, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
    });
    assert.equal(result.plan.nodes.length, 1);
    assert.equal(result.plan.title, "Fixture plan");
    assert.equal(result.model.modelId, "gpt-5.6-terra");
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("rejects a plan with a self-dependency even from the injected seam", async () => {
  const badPlan: MissionPlan = {
    title: "Bad plan",
    summary: "Self-referential dependency",
    nodes: [
      {
        clientId: "n1",
        codename: "scout",
        roleLabel: "Scout",
        objective: "Gather fixture evidence",
        capabilityNames: [],
        dependsOn: ["n1"],
      },
    ],
    approvalBoundaries: [],
  };
  await assert.rejects(() =>
    generateMissionPlan(BASE_INPUT, {
      generate: async () => ({ plan: badPlan, usage: {} }),
    }),
  );
});
