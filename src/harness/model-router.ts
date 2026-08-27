import type { ModelEscalationSignals, ModelTier } from "./contracts";

export type ModelRoute = {
  tier: ModelTier;
  modelId: "gpt-5.6-terra" | "gpt-5.6-sol";
  reasoningEffort: "low" | "medium" | "high";
  reason: string;
};

export function routeModel(signals?: ModelEscalationSignals): ModelRoute {
  if (!signals) {
    return {
      tier: "terra",
      modelId: "gpt-5.6-terra",
      reasoningEffort: "low",
      reason: "default_low_risk",
    };
  }

  const shouldEscalate =
    signals.validationFailures >= 2 ||
    signals.dependencyDepth >= 5 ||
    signals.conflictingConstraints >= 2 ||
    signals.riskLevel === "critical" ||
    signals.toolFailures >= 2 ||
    (signals.evaluatorScore !== undefined && signals.evaluatorScore < 0.65);

  if (shouldEscalate) {
    return {
      tier: "sol",
      modelId: "gpt-5.6-sol",
      reasoningEffort: signals.riskLevel === "critical" ? "high" : "medium",
      reason: "bounded_complexity_escalation",
    };
  }

  return {
    tier: "terra",
    modelId: "gpt-5.6-terra",
    reasoningEffort:
      signals.riskLevel === "high" || signals.dependencyDepth >= 3 ? "medium" : "low",
    reason: "balanced_default",
  };
}

/**
 * Map a routing decision to redaction-safe span attributes. Pure and
 * side-effect-free so it can be tested in isolation and attached to the model
 * call span in the planner. Every field here (model id, tier, reasoning effort,
 * escalation reason enum) is on the observability allowlist and carries no user
 * input, prompt content, or credential.
 */
export function describeModelRoute(route: ModelRoute): {
  modelId: string;
  modelTier: string;
  reasoningEffort: string;
  escalationReason: string;
} {
  return {
    modelId: route.modelId,
    modelTier: route.tier,
    reasoningEffort: route.reasoningEffort,
    escalationReason: route.reason,
  };
}
