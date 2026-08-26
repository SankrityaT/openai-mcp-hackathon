import type {
  ActionCategory,
  AuthorityPolicy,
  BudgetSnapshot,
  JsonValue,
  QuotaSnapshot,
  RiskLevel,
  TrustLevel,
} from "../contracts/types";
import { ContractValidationError, parseOrigin } from "../contracts/validation";

export type PolicyEffect =
  | "allow"
  | "require_approval"
  | "deny"
  | "require_takeover"
  | "require_reauthentication";

export type IdempotencyState =
  | "new"
  | "reserved"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "conflict";

export type PriorApproval = {
  status: "approved" | "modified" | "rejected" | "expired";
  actionFingerprint: string;
  mandateVersion: number;
  stillValid: boolean;
};

export type ToolAnnotations = {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  externalSideEffect: boolean;
  sensitive: boolean;
  requiresUserPresence: boolean;
};

export type PolicyInput = {
  mandate: {
    version: number;
    authority: AuthorityPolicy;
  };
  userAuthority: {
    authenticated: boolean;
    canTakeover: boolean;
    reauthenticatedForAction: boolean;
  };
  contextCardOverrides: Partial<AuthorityPolicy>[];
  capability: {
    id: string;
    riskLevel: RiskLevel;
    riskCategories: ActionCategory[];
    trust: TrustLevel;
  };
  tool: ToolAnnotations;
  action: {
    category: ActionCategory;
    fingerprint: string;
    estimatedCostMicrounits: number;
  };
  origin: string;
  target: string;
  quota: QuotaSnapshot;
  budget: BudgetSnapshot;
  priorApproval?: PriorApproval;
  idempotencyState: IdempotencyState;
};

export type PolicyDecision = {
  effect: PolicyEffect;
  code: string;
  reasons: string[];
  permanentHardStop: boolean;
  replayExistingResult: boolean;
  auditEventType?: "policy.denied" | "security.recorded";
};

const hardStopCategories = new Set<ActionCategory>([
  "payment_or_purchase",
  "legal_agreement_or_signature",
  "account_credential_or_permission_change",
  "sensitive_outbound_message",
  "destructive_deletion",
  "protected_personal_data_disclosure",
]);

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function decision(
  effect: PolicyEffect,
  code: string,
  reasons: string[],
  options?: Partial<
    Pick<PolicyDecision, "permanentHardStop" | "replayExistingResult" | "auditEventType">
  >,
): PolicyDecision {
  return {
    effect,
    code,
    reasons,
    permanentHardStop: options?.permanentHardStop ?? false,
    replayExistingResult: options?.replayExistingResult ?? false,
    auditEventType: options?.auditEventType,
  };
}

function intersect<T>(base: T[], override: T[] | undefined): T[] {
  return override === undefined ? base : base.filter((value) => override.includes(value));
}

export function compileEffectiveAuthority(
  authority: AuthorityPolicy,
  overrides: Partial<AuthorityPolicy>[],
): AuthorityPolicy {
  return overrides.reduce<AuthorityPolicy>((effective, override) => ({
    freePassage: effective.freePassage && (override.freePassage ?? true),
    allowedCapabilityIds: intersect(effective.allowedCapabilityIds, override.allowedCapabilityIds),
    allowedOrigins: intersect(effective.allowedOrigins, override.allowedOrigins),
    allowedTargets: intersect(effective.allowedTargets, override.allowedTargets),
    allowedRiskLevels: intersect(effective.allowedRiskLevels, override.allowedRiskLevels),
    maxAutonomousCostMicrounits: Math.min(
      effective.maxAutonomousCostMicrounits,
      override.maxAutonomousCostMicrounits ?? effective.maxAutonomousCostMicrounits,
    ),
    allowExternalSideEffects:
      effective.allowExternalSideEffects && (override.allowExternalSideEffects ?? true),
    requireApprovalCategories: Array.from(
      new Set([
        ...effective.requireApprovalCategories,
        ...(override.requireApprovalCategories ?? []),
      ]),
    ),
  }), authority);
}

function validatePolicyInput(input: PolicyInput): void {
  const issues: string[] = [];
  if (!Number.isSafeInteger(input.mandate.version) || input.mandate.version < 1) {
    issues.push("mandate.version must be a positive integer");
  }
  if (input.capability.id.length < 1 || input.capability.id.length > 200) {
    issues.push("capability.id must contain between 1 and 200 characters");
  }
  if (input.action.fingerprint.length < 16 || input.action.fingerprint.length > 200) {
    issues.push("action.fingerprint must contain between 16 and 200 characters");
  }
  if (
    !Number.isSafeInteger(input.action.estimatedCostMicrounits) ||
    input.action.estimatedCostMicrounits < 0
  ) {
    issues.push("action.estimatedCostMicrounits must be a non-negative integer");
  }
  try {
    parseOrigin(input.origin);
  } catch (error) {
    if (error instanceof ContractValidationError) issues.push(...error.issues);
    else throw error;
  }
  if (input.target.length < 1 || input.target.length > 2_048) {
    issues.push("target must contain between 1 and 2048 characters");
  }
  if (input.contextCardOverrides.length > 100) {
    issues.push("contextCardOverrides cannot exceed 100 entries");
  }
  if (issues.length > 0) throw new ContractValidationError(issues);
}

function hasExactApproval(input: PolicyInput): boolean {
  const approval = input.priorApproval;
  return Boolean(
    approval &&
      (approval.status === "approved" || approval.status === "modified") &&
      approval.stillValid &&
      approval.actionFingerprint === input.action.fingerprint &&
      approval.mandateVersion === input.mandate.version,
  );
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  validatePolicyInput(input);

  if (input.idempotencyState === "succeeded") {
    return decision("allow", "idempotent_replay", ["Return the stored result without repeating the side effect."], {
      replayExistingResult: true,
    });
  }
  if (input.idempotencyState === "reserved") {
    return decision("deny", "idempotency_in_progress", ["The same request is already reserved or running."], {
      auditEventType: "policy.denied",
    });
  }
  if (input.idempotencyState === "conflict") {
    return decision("deny", "idempotency_conflict", ["The key is already bound to a different request fingerprint."], {
      auditEventType: "security.recorded",
    });
  }
  if (input.idempotencyState === "failed_terminal") {
    return decision("deny", "terminal_attempt", ["This operation cannot be retried safely."], {
      auditEventType: "policy.denied",
    });
  }
  if (!input.userAuthority.authenticated) {
    return decision("require_reauthentication", "authentication_required", ["The action requires a verified user session."]);
  }

  const authority = compileEffectiveAuthority(
    input.mandate.authority,
    input.contextCardOverrides,
  );
  if (!authority.allowedCapabilityIds.includes(input.capability.id)) {
    return decision("deny", "capability_not_allowed", ["The capability is outside the approved mandate allowlist."], {
      permanentHardStop: true,
      auditEventType: "policy.denied",
    });
  }
  if (!authority.allowedOrigins.includes(input.origin)) {
    return decision("deny", "origin_not_allowed", ["The origin is outside the approved mandate allowlist."], {
      permanentHardStop: true,
      auditEventType: "security.recorded",
    });
  }
  if (!authority.allowedTargets.includes(input.target)) {
    return decision("deny", "target_not_allowed", ["The target is outside the approved mandate allowlist."], {
      permanentHardStop: true,
      auditEventType: "security.recorded",
    });
  }
  if (!authority.allowedRiskLevels.includes(input.capability.riskLevel)) {
    return decision("deny", "risk_not_authorized", ["The capability risk exceeds the mandate authority."], {
      auditEventType: "policy.denied",
    });
  }
  if (input.quota.exhausted) {
    return decision("deny", "quota_exhausted", ["The server-authorized quota is exhausted."], {
      auditEventType: "policy.denied",
    });
  }
  if (
    input.budget.exhausted ||
    input.budget.spentCostMicrounits + input.action.estimatedCostMicrounits >
      input.budget.limitCostMicrounits
  ) {
    return decision("deny", "budget_exhausted", ["The action would exceed the mission cost budget."], {
      auditEventType: "policy.denied",
    });
  }

  const categoryIsHardStop = hardStopCategories.has(input.action.category);
  if (input.action.category === "legal_agreement_or_signature" || input.tool.requiresUserPresence) {
    return decision("require_takeover", "user_presence_required", ["The user must personally complete this action."], {
      permanentHardStop: categoryIsHardStop,
    });
  }
  if (
    input.action.category === "account_credential_or_permission_change" &&
    !input.userAuthority.reauthenticatedForAction
  ) {
    return decision("require_reauthentication", "fresh_authentication_required", ["A fresh authentication check is required for this account change."], {
      permanentHardStop: true,
    });
  }
  if (categoryIsHardStop && !hasExactApproval(input)) {
    return decision("require_approval", "permanent_hard_stop", ["Free Passage cannot authorize this consequential category."], {
      permanentHardStop: true,
    });
  }
  if (input.tool.destructive && !hasExactApproval(input)) {
    return decision("require_approval", "destructive_action", ["A destructive action requires an exact current approval."], {
      permanentHardStop: true,
    });
  }
  if (input.capability.trust === "untrusted") {
    return decision("require_approval", "untrusted_capability", ["The capability or its evidence is untrusted."]);
  }
  if (input.capability.riskLevel === "critical") {
    return input.userAuthority.canTakeover
      ? decision("require_takeover", "critical_risk", ["Critical-risk execution requires direct user control."])
      : decision("deny", "critical_risk_no_takeover", ["Critical-risk execution has no safe takeover path."], {
          auditEventType: "policy.denied",
        });
  }
  if (
    input.capability.riskLevel === "high" ||
    authority.requireApprovalCategories.includes(input.action.category)
  ) {
    return hasExactApproval(input)
      ? decision("allow", "approved_exact_action", ["A current exact approval authorizes this action."])
      : decision("require_approval", "approval_required", ["The mandate requires approval for this risk or category."]);
  }

  const autonomousCostAllowed =
    input.action.estimatedCostMicrounits <= authority.maxAutonomousCostMicrounits;
  const sideEffectAllowed =
    !input.tool.externalSideEffect || authority.allowExternalSideEffects;
  if (authority.freePassage && autonomousCostAllowed && sideEffectAllowed) {
    return decision("allow", "free_passage_within_limits", ["The action is inside explicit Free Passage limits."]);
  }
  if (input.tool.externalSideEffect && !hasExactApproval(input)) {
    return decision("require_approval", "external_side_effect", ["External side effects require approval outside Free Passage."]);
  }
  if (!autonomousCostAllowed && !hasExactApproval(input)) {
    return decision("require_approval", "autonomous_cost_limit", ["The estimated cost exceeds the autonomous limit."]);
  }
  if (riskRank[input.capability.riskLevel] > riskRank.medium && !hasExactApproval(input)) {
    return decision("require_approval", "elevated_risk", ["Elevated risk requires an exact approval."]);
  }
  return decision("allow", "within_mandate", ["The request is read-only or within explicit mandate authority."]);
}

export function isPermanentHardStop(category: ActionCategory): boolean {
  return hardStopCategories.has(category);
}

export function redactPolicyInput(input: PolicyInput): JsonValue {
  return {
    mandateVersion: input.mandate.version,
    capabilityId: input.capability.id,
    riskLevel: input.capability.riskLevel,
    riskCategories: input.capability.riskCategories,
    trust: input.capability.trust,
    actionCategory: input.action.category,
    actionFingerprint: input.action.fingerprint,
    origin: input.origin,
    target: input.target,
    quotaExhausted: input.quota.exhausted,
    budgetExhausted: input.budget.exhausted,
    idempotencyState: input.idempotencyState,
  };
}
