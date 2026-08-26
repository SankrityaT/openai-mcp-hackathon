import type {
  JsonValue,
  MissionEventType,
  MissionStatus,
  NodeStatus,
  TrustLevel,
} from "./types";
import {
  assertBoundedJson,
  ContractValidationError,
  parseAuthorityPolicy,
  parseUuid,
} from "./validation";
import { MISSION_EVENT_CATALOGUE } from "../events/catalogue";

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError([`${path} must be an object`]);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new ContractValidationError([
      `${path} must contain between 1 and ${maximum} characters`,
    ]);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ContractValidationError([`${path} must be a non-negative integer`]);
  }
  return value as number;
}

function boundedArray(value: unknown, path: string, maximum = 100): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ContractValidationError([`${path} must contain at most ${maximum} items`]);
  }
  return value;
}

export type CreateMissionBody = {
  title: string;
  goal: string;
  constraints: JsonValue[];
  authority: ReturnType<typeof parseAuthorityPolicy>;
  selectedContextCardIds: string[];
  budgetLimits: JsonValue;
  correlationId?: string;
};

export function parseCreateMissionBody(value: unknown): CreateMissionBody {
  const input = object(value, "body");
  const budgetLimits = assertBoundedJson(input.budgetLimits ?? {}, "body.budgetLimits", 16_384);
  if (budgetLimits === null || Array.isArray(budgetLimits) || typeof budgetLimits !== "object") {
    throw new ContractValidationError(["body.budgetLimits must be an object"]);
  }
  return {
    title: boundedString(input.title, "body.title", 200),
    goal: boundedString(input.goal, "body.goal", 8_000),
    constraints: boundedArray(input.constraints ?? [], "body.constraints").map((item, index) =>
      assertBoundedJson(item, `body.constraints[${index}]`, 8_000),
    ),
    authority: parseAuthorityPolicy(input.authority, "body.authority"),
    selectedContextCardIds: boundedArray(
      input.selectedContextCardIds ?? [],
      "body.selectedContextCardIds",
    ).map((item, index) => parseUuid(item, `body.selectedContextCardIds[${index}]`)),
    budgetLimits,
    correlationId:
      input.correlationId === undefined
        ? undefined
        : parseUuid(input.correlationId, "body.correlationId"),
  };
}

const missionStatuses = new Set<MissionStatus>([
  "draft", "planning", "running", "waiting", "completed", "failed", "cancelled",
]);
const nodeStatuses = new Set<NodeStatus>([
  "planned", "running", "paused", "waiting", "needs_approval", "completed", "failed", "cancelled",
]);
const trustLevels = new Set<TrustLevel>(["trusted", "untrusted", "derived"]);
const userAppendableEventTypes = new Set<MissionEventType>([
  "mission.cancelled",
  "mandate.revised",
  "mandate.approved",
  "node.paused",
  "node.resumed",
  "node.redirected",
]);

export type AppendEventBody = {
  expectedSequence: number;
  type: MissionEventType;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: JsonValue;
  trust: TrustLevel;
  missionStatus?: MissionStatus;
  nodeId?: string;
  nodeStatus?: NodeStatus;
};

export function parseAppendEventBody(value: unknown): AppendEventBody {
  const input = object(value, "body");
  const type = boundedString(input.type, "body.type", 120) as MissionEventType;
  if (!(type in MISSION_EVENT_CATALOGUE)) {
    throw new ContractValidationError(["body.type is not a known mission event"]);
  }
  const trust = boundedString(input.trust, "body.trust", 20) as TrustLevel;
  if (!trustLevels.has(trust)) {
    throw new ContractValidationError(["body.trust is invalid"]);
  }
  const missionStatus = input.missionStatus as MissionStatus | undefined;
  const nodeStatus = input.nodeStatus as NodeStatus | undefined;
  if (missionStatus !== undefined && !missionStatuses.has(missionStatus)) {
    throw new ContractValidationError(["body.missionStatus is invalid"]);
  }
  if (nodeStatus !== undefined && !nodeStatuses.has(nodeStatus)) {
    throw new ContractValidationError(["body.nodeStatus is invalid"]);
  }
  return {
    expectedSequence: positiveInteger(input.expectedSequence, "body.expectedSequence"),
    type,
    correlationId: parseUuid(input.correlationId, "body.correlationId"),
    causationId:
      input.causationId === undefined
        ? undefined
        : parseUuid(input.causationId, "body.causationId"),
    idempotencyKey:
      input.idempotencyKey === undefined
        ? undefined
        : boundedString(input.idempotencyKey, "body.idempotencyKey", 200),
    payload: assertBoundedJson(input.payload ?? {}, "body.payload"),
    trust,
    missionStatus,
    nodeId: input.nodeId === undefined ? undefined : parseUuid(input.nodeId, "body.nodeId"),
    nodeStatus,
  };
}

export function assertUserAppendableEvent(body: AppendEventBody) {
  if (!userAppendableEventTypes.has(body.type)) {
    throw new ContractValidationError(["body.type cannot be appended by a user session"]);
  }
  if (body.trust !== "trusted") {
    throw new ContractValidationError(["User-originated control events must be trusted"]);
  }
  if (
    (body.type === "node.paused" && body.nodeStatus !== "paused") ||
    (body.type === "node.resumed" && body.nodeStatus !== "running") ||
    (body.type === "mission.cancelled" && body.missionStatus !== "cancelled")
  ) {
    throw new ContractValidationError(["Event materialization does not match its event type"]);
  }
  if (body.type.startsWith("node.") && !body.nodeId) {
    throw new ContractValidationError(["Node control events require body.nodeId"]);
  }
  if (
    body.type.startsWith("mandate.") &&
    (body.nodeId || body.nodeStatus || body.missionStatus)
  ) {
    throw new ContractValidationError([
      "Mandate events cannot carry mission or node status materialization",
    ]);
  }
  return body;
}

export type ResolveApprovalBody = {
  decision: "accepted" | "modified" | "rejected";
  resolution: JsonValue;
  correlationId: string;
  idempotencyKey: string;
};

export function parseResolveApprovalBody(value: unknown): ResolveApprovalBody {
  const input = object(value, "body");
  if (!['accepted', 'modified', 'rejected'].includes(String(input.decision))) {
    throw new ContractValidationError(["body.decision is invalid"]);
  }
  return {
    decision: input.decision as ResolveApprovalBody["decision"],
    resolution: assertBoundedJson(input.resolution ?? {}, "body.resolution"),
    correlationId: parseUuid(input.correlationId, "body.correlationId"),
    idempotencyKey: boundedString(input.idempotencyKey, "body.idempotencyKey", 200),
  };
}

export async function readBoundedJsonBody(request: Request, maximumBytes = 131_072) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ContractValidationError([`Request body exceeds ${maximumBytes} bytes`]);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new ContractValidationError([`Request body exceeds ${maximumBytes} bytes`]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContractValidationError(["Request body must be valid JSON"]);
  }
}
