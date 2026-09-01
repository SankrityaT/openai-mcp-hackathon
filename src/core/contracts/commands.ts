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

/**
 * Known `BudgetLimits` fields (src/core/contracts/types.ts) and the inclusive
 * range each may take. Unknown fields are dropped, non-numeric values are
 * dropped, and out-of-range numbers are clamped rather than rejected, so an
 * over-eager client still creates a bounded mission instead of an unbounded
 * one.
 */
const BUDGET_LIMIT_RANGES: Record<string, { minimum: number; maximum: number }> = {
  maxModelCalls: { minimum: 0, maximum: 10_000 },
  maxInputTokens: { minimum: 0, maximum: 100_000_000 },
  maxOutputTokens: { minimum: 0, maximum: 100_000_000 },
  maxToolCalls: { minimum: 0, maximum: 10_000 },
  maxRetries: { minimum: 0, maximum: 10 },
  maxConcurrentWorkers: { minimum: 1, maximum: 50 },
  maxWallClockMs: { minimum: 1_000, maximum: 3_600_000 },
  maxCostMicrounits: { minimum: 0, maximum: 10_000_000_000 },
  maxUntrustedBytes: { minimum: 0, maximum: 1_000_000_000 },
};

// Ceilings the parser never leaves open. `maxRetries` matches the canvas
// client's DEFAULT_MISSION_BUDGET_LIMITS; the wall-clock ceiling is five
// minutes per node run, safely under the harness's 10 minute invoke timeout.
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_WALL_CLOCK_MS = 5 * 60 * 1_000;

/**
 * Bounded `budgetLimits` validation. An empty object used to pass through
 * verbatim, which disabled the retry and wall-clock ceilings entirely; now
 * only known numeric fields survive, each clamped, and the retry and
 * wall-clock ceilings are always present.
 */
function parseBudgetLimits(value: unknown, path: string): Record<string, number> {
  const raw = assertBoundedJson(value ?? {}, path, 16_384);
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") {
    throw new ContractValidationError([`${path} must be an object`]);
  }
  const limits: Record<string, number> = {};
  for (const [field, range] of Object.entries(BUDGET_LIMIT_RANGES)) {
    const candidate = (raw as Record<string, unknown>)[field];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    limits[field] = Math.min(range.maximum, Math.max(range.minimum, Math.floor(candidate)));
  }
  limits.maxRetries ??= DEFAULT_MAX_RETRIES;
  limits.maxWallClockMs ??= DEFAULT_MAX_WALL_CLOCK_MS;
  return limits;
}

export function parseCreateMissionBody(value: unknown): CreateMissionBody {
  const input = object(value, "body");
  const budgetLimits = parseBudgetLimits(input.budgetLimits, "body.budgetLimits");
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
  // A browser session may record evidence it captured from an external WebMCP origin (the
  // companion site) so the cross-origin result becomes durable mission provenance. It is the
  // only catalogued type whose purpose is provenance-carrying evidence, it does not materialize
  // mission or node state, and it is admitted under the untrusted-only rule below.
  "evidence.recorded",
]);

/**
 * Event types a browser session may append with `trust: "untrusted"`.
 *
 * Control events must stay trusted because they express the user's own intent. Captured external
 * content is the opposite: it is third-party data and must never be able to enter the log
 * claiming trust. So the trust requirement is inverted for exactly these types.
 */
const untrustedOnlyUserAppendableEventTypes = new Set<MissionEventType>(["evidence.recorded"]);

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
  if (untrustedOnlyUserAppendableEventTypes.has(body.type)) {
    if (body.trust !== "untrusted") {
      throw new ContractValidationError([
        "Captured external evidence must be appended as untrusted",
      ]);
    }
    if (body.missionStatus !== undefined || body.nodeStatus !== undefined) {
      throw new ContractValidationError([
        "Evidence events cannot carry mission or node status materialization",
      ]);
    }
  } else if (body.trust !== "trusted") {
    throw new ContractValidationError(["User-originated control events must be trusted"]);
  }
  // Exact per-type materialization allowlist, mirroring the non-service-role
  // guard in append_mission_event (migration ...000200...). This MUST be
  // enforced at the app layer, not only in SQL: guest and judge sessions
  // write through the service-role admin client (see resolveMissionWriteContext),
  // which bypasses that DB guard. Without this, a browser session could forge
  // an arbitrary mission.status / node.status via a control event. Each rule
  // is a positive contract: exactly what this event type may materialize.
  const forgeryError = () =>
    new ContractValidationError(["Event materialization does not match its event type"]);
  switch (body.type) {
    case "node.paused":
      if (body.nodeStatus !== "paused" || body.missionStatus !== undefined) throw forgeryError();
      break;
    case "node.resumed":
      if (body.nodeStatus !== "running" || body.missionStatus !== undefined) throw forgeryError();
      break;
    case "node.redirected":
      if (body.nodeStatus !== undefined || body.missionStatus !== undefined) throw forgeryError();
      break;
    case "mission.cancelled":
      if (body.missionStatus !== "cancelled" || body.nodeId || body.nodeStatus !== undefined) {
        throw forgeryError();
      }
      break;
    case "mandate.revised":
    case "mandate.approved":
      if (body.nodeId || body.nodeStatus !== undefined || body.missionStatus !== undefined) {
        throw forgeryError();
      }
      break;
    case "evidence.recorded":
      // Already constrained above (untrusted, no materialization).
      break;
    default:
      // Any other user-appendable type must not materialize state at all.
      if (body.missionStatus !== undefined || body.nodeStatus !== undefined) throw forgeryError();
  }
  if (body.type.startsWith("node.") && !body.nodeId) {
    throw new ContractValidationError(["Node control events require body.nodeId"]);
  }
  return body;
}

export type ResolveApprovalBody = {
  missionId: string;
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
    missionId: parseUuid(input.missionId, "body.missionId"),
    decision: input.decision as ResolveApprovalBody["decision"],
    resolution: assertBoundedJson(input.resolution ?? {}, "body.resolution"),
    correlationId: parseUuid(input.correlationId, "body.correlationId"),
    idempotencyKey: boundedString(input.idempotencyKey, "body.idempotencyKey", 200),
  };
}

export type JudgeRedeemBody = { code: string };

/**
 * Bounded parser for a judge code submission. The code is never logged, stored,
 * or echoed: only its hash is ever compared server-side.
 */
export function parseJudgeRedeemBody(value: unknown): JudgeRedeemBody {
  const input = object(value, "body");
  return { code: boundedString(input.code, "body.code", 200) };
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
