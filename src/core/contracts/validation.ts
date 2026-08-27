import type {
  ActionCategory,
  Actor,
  AuthorityPolicy,
  JsonValue,
  Mandate,
  MissionEvent,
  MissionEventType,
  RiskLevel,
  TrustLevel,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGIN_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export const CONTRACT_LIMITS = {
  title: 200,
  goal: 8_000,
  description: 4_000,
  identifier: 200,
  origin: 2_048,
  collection: 100,
  eventPayloadBytes: 65_536,
  schemaBytes: 131_072,
} as const;

export class ContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Contract validation failed: ${issues.join("; ")}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError([`${path} must be an object`]);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new ContractValidationError([
      `${path} must be a string between ${min} and ${max} characters`,
    ]);
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ContractValidationError([`${path} must be an integer between ${min} and ${max}`]);
  }
  return value as number;
}

function array(value: unknown, path: string, max = CONTRACT_LIMITS.collection): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new ContractValidationError([`${path} must be an array with at most ${max} items`]);
  }
  return value;
}

function oneOf<const TValue extends string>(
  value: unknown,
  path: string,
  values: readonly TValue[],
): TValue {
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new ContractValidationError([`${path} is not an allowed value`]);
  }
  return value as TValue;
}

function json(value: unknown, path: string, maxBytes: number): JsonValue {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ContractValidationError([`${path} must be JSON serializable`]);
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new ContractValidationError([`${path} exceeds the ${maxBytes} byte limit`]);
  }
  return value as JsonValue;
}

export function parseUuid(value: unknown, path = "id"): string {
  const parsed = string(value, path, 36, 36);
  if (!UUID_PATTERN.test(parsed)) {
    throw new ContractValidationError([`${path} must be a UUID`]);
  }
  return parsed;
}

export function parseOrigin(value: unknown, path = "origin"): string {
  const parsed = string(value, path, CONTRACT_LIMITS.origin);
  if (!ORIGIN_PATTERN.test(parsed)) {
    throw new ContractValidationError([`${path} must be an absolute HTTP(S) origin`]);
  }
  const url = new URL(parsed);
  if (url.origin !== parsed) {
    throw new ContractValidationError([`${path} must not include a path, query, or fragment`]);
  }
  return parsed;
}

export function parseActor(value: unknown, path = "actor"): Actor {
  const input = record(value, path);
  return {
    kind: oneOf(input.kind, `${path}.kind`, ["user", "cardea", "tool", "system"]),
    id: string(input.id, `${path}.id`, CONTRACT_LIMITS.identifier),
  };
}

const riskLevels = ["low", "medium", "high", "critical"] as const satisfies readonly RiskLevel[];
const actionCategories = [
  "read",
  "external_write",
  "payment_or_purchase",
  "legal_agreement_or_signature",
  "account_credential_or_permission_change",
  "sensitive_outbound_message",
  "destructive_deletion",
  "protected_personal_data_disclosure",
] as const satisfies readonly ActionCategory[];

export function parseAuthorityPolicy(value: unknown, path = "authority"): AuthorityPolicy {
  const input = record(value, path);
  if (typeof input.freePassage !== "boolean" || typeof input.allowExternalSideEffects !== "boolean") {
    throw new ContractValidationError([
      `${path}.freePassage and ${path}.allowExternalSideEffects must be booleans`,
    ]);
  }
  const parseStrings = (key: string, max: number = CONTRACT_LIMITS.identifier) =>
    array(input[key], `${path}.${key}`).map((item, index) =>
      string(item, `${path}.${key}[${index}]`, max),
    );
  return {
    freePassage: input.freePassage,
    allowedCapabilityIds: parseStrings("allowedCapabilityIds"),
    // Optional, and absent means "no capability is approval-gated by id" —
    // exactly what an authority written before this field meant.
    ...(input.approvalGatedCapabilityIds === undefined
      ? {}
      : { approvalGatedCapabilityIds: parseStrings("approvalGatedCapabilityIds") }),
    allowedOrigins: array(input.allowedOrigins, `${path}.allowedOrigins`).map((item, index) =>
      parseOrigin(item, `${path}.allowedOrigins[${index}]`),
    ),
    allowedTargets: parseStrings("allowedTargets", CONTRACT_LIMITS.origin),
    allowedRiskLevels: array(input.allowedRiskLevels, `${path}.allowedRiskLevels`).map(
      (item, index) => oneOf(item, `${path}.allowedRiskLevels[${index}]`, riskLevels),
    ),
    maxAutonomousCostMicrounits: integer(
      input.maxAutonomousCostMicrounits,
      `${path}.maxAutonomousCostMicrounits`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    allowExternalSideEffects: input.allowExternalSideEffects,
    requireApprovalCategories: array(
      input.requireApprovalCategories,
      `${path}.requireApprovalCategories`,
    ).map((item, index) =>
      oneOf(item, `${path}.requireApprovalCategories[${index}]`, actionCategories),
    ),
  };
}

export function parseMandate(value: unknown): Mandate {
  const input = record(value, "mandate");
  return {
    missionId: parseUuid(input.missionId, "mandate.missionId"),
    version: integer(input.version, "mandate.version", 1, 1_000_000),
    goal: string(input.goal, "mandate.goal", CONTRACT_LIMITS.goal),
    constraints: array(input.constraints, "mandate.constraints").map((item, index) =>
      json(item, `mandate.constraints[${index}]`, CONTRACT_LIMITS.description),
    ),
    authority: parseAuthorityPolicy(input.authority, "mandate.authority"),
    selectedContextCardIds: array(
      input.selectedContextCardIds,
      "mandate.selectedContextCardIds",
    ).map((item, index) => parseUuid(item, `mandate.selectedContextCardIds[${index}]`)),
    createdBy: parseActor(input.createdBy, "mandate.createdBy"),
    createdAt: string(input.createdAt, "mandate.createdAt", 64),
  };
}

export function parseMissionEvent(value: unknown): MissionEvent {
  const input = record(value, "event");
  const knownTypes: MissionEventType[] = [
    "mission.created", "mission.completed", "mission.failed", "mission.cancelled",
    "mission.reverted", "mandate.proposed", "mandate.revised", "mandate.approved",
    "node.planned", "node.started", "node.paused", "node.resumed", "node.redirected",
    "node.completed", "node.failed", "node.reverted", "capability.discovered",
    "tool.requested", "tool.approved", "tool.started", "tool.completed", "tool.failed",
    "evidence.recorded", "memory.proposed", "memory.promoted", "memory.edited",
    "memory.forgotten", "approval.requested", "approval.resolved", "approval.expired",
    "dependency.added", "dependency.removed", "dependency.rerouted", "checkpoint.created",
    "quota.consumed", "policy.denied", "security.recorded",
  ];
  return {
    id: parseUuid(input.id, "event.id"),
    tenantId: parseUuid(input.tenantId, "event.tenantId"),
    missionId: parseUuid(input.missionId, "event.missionId"),
    nodeId: input.nodeId === undefined ? undefined : parseUuid(input.nodeId, "event.nodeId"),
    sequence: integer(input.sequence, "event.sequence", 1, Number.MAX_SAFE_INTEGER),
    type: oneOf(input.type, "event.type", knownTypes),
    actor: parseActor(input.actor, "event.actor"),
    correlationId: parseUuid(input.correlationId, "event.correlationId"),
    causationId:
      input.causationId === undefined
        ? undefined
        : parseUuid(input.causationId, "event.causationId"),
    idempotencyKey:
      input.idempotencyKey === undefined
        ? undefined
        : string(input.idempotencyKey, "event.idempotencyKey", CONTRACT_LIMITS.identifier),
    payload: json(input.payload, "event.payload", CONTRACT_LIMITS.eventPayloadBytes),
    trust: oneOf(input.trust, "event.trust", [
      "trusted",
      "untrusted",
      "derived",
    ] satisfies readonly TrustLevel[]),
    createdAt: string(input.createdAt, "event.createdAt", 64),
  };
}

export function assertBoundedJson(
  value: unknown,
  path: string,
  maxBytes: number = CONTRACT_LIMITS.eventPayloadBytes,
): JsonValue {
  return json(value, path, maxBytes);
}
