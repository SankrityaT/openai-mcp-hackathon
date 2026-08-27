/**
 * Request rules and the wire shape for standing missions.
 *
 * Split out of the route modules for the same reason as
 * `composio/connections/connect-request.ts`: a Next.js route handler
 * transitively imports `server-only` and the Supabase client, so it cannot be
 * loaded under plain `node --test`. The rules that carry the weight live here,
 * where they are actually tested:
 *
 *  - only a signed-in account may own a standing mission (guest, judge, and
 *    anonymous principals are 401, not a degraded version of the feature),
 *  - every field is bounded before it reaches the database, the same way
 *    `parseCreateMissionBody` bounds a one-off mission,
 *  - the captured authority is the least-authority default with only the
 *    caller's explicitly named fields merged over it, so a standing mission
 *    can never start out broader than a mission created by hand.
 */

import {
  DEFAULT_MISSION_AUTHORITY,
  DEFAULT_MISSION_BUDGET_LIMITS,
  deriveMissionTitle,
} from "./mission-data-source";
import type { AuthorityPolicy, BudgetLimits } from "./types";
import { ContractValidationError, parseAuthorityPolicy, parseUuid } from "./validation";
import { isStandingCadence, type StandingCadence } from "../policy/standing-cadence";

export const STANDING_MISSION_LIMITS = {
  /** Matches `CONTRACT_LIMITS.goal` and the `create_mission` bound. */
  goal: 8_000,
  /**
   * Shorter than a mission title's 200 so the spawner's " · YYYY-MM-DD" run
   * suffix always fits inside the mission title bound rather than truncating.
   */
  title: 160,
  selectedContextCardIds: 100,
} as const;

/**
 * Mirrors `MissionPrincipal` without importing the server-only resolver.
 */
export type StandingMissionPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "judge" }
  | { kind: "guest" }
  | { kind: "anonymous" };

export type StandingMissionRejection =
  | { status: 401; error: "authentication_required" }
  | { status: 404; error: "not_found" };

export const STANDING_AUTHENTICATION_REQUIRED: StandingMissionRejection = {
  status: 401,
  error: "authentication_required",
};

export const STANDING_NOT_FOUND: StandingMissionRejection = { status: 404, error: "not_found" };

/**
 * The account that owns this request, or a 401.
 *
 * Guest and judge sessions are refused rather than mapped onto a shared owner.
 * A standing mission runs unattended for as long as it is enabled: it needs an
 * account to charge quota to and a person to stop for, and those two doors
 * exist precisely so that no account is involved.
 */
export function resolveStandingMissionOwner(
  principal: StandingMissionPrincipal,
): { ok: true; userId: string } | { ok: false; rejection: StandingMissionRejection } {
  if (principal.kind !== "user" || principal.userId.length === 0) {
    return { ok: false, rejection: STANDING_AUTHENTICATION_REQUIRED };
  }
  return { ok: true, userId: principal.userId };
}

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

/**
 * The least-authority default with only the fields the caller actually named
 * merged over it, then re-validated as a whole. Merging this way (rather than
 * accepting a full policy) means an omitted field is the safe default, not
 * whatever the caller left out of the object.
 */
export function mergeStandingAuthority(value: unknown, path = "body.authority"): AuthorityPolicy {
  if (value === undefined || value === null) return { ...DEFAULT_MISSION_AUTHORITY };
  const overrides = object(value, path);
  return parseAuthorityPolicy({ ...DEFAULT_MISSION_AUTHORITY, ...overrides }, path);
}

/** Mirrors the composer: the wallet's loaded passes raise only the ceiling. */
export function mergeStandingBudget(value: unknown, path = "body.budgetMicrounits"): BudgetLimits {
  if (value === undefined || value === null) return { ...DEFAULT_MISSION_BUDGET_LIMITS };
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ContractValidationError([`${path} must be a non-negative integer`]);
  }
  const microunits = value as number;
  return {
    ...DEFAULT_MISSION_BUDGET_LIMITS,
    ...(microunits > 0 ? { maxCostMicrounits: microunits } : {}),
  };
}

export type CreateStandingMissionBody = {
  goal: string;
  title: string;
  cadence: StandingCadence;
  hourUtc: number;
  authority: AuthorityPolicy;
  budgetLimits: BudgetLimits;
  selectedContextCardIds: string[];
};

export function parseCreateStandingMissionBody(value: unknown): CreateStandingMissionBody {
  const input = object(value, "body");
  const goal = boundedString(input.goal, "body.goal", STANDING_MISSION_LIMITS.goal);

  if (!isStandingCadence(input.cadence)) {
    throw new ContractValidationError([
      "body.cadence must be one of daily, weekdays, weekly",
    ]);
  }
  if (!Number.isSafeInteger(input.hourUtc) || (input.hourUtc as number) < 0 || (input.hourUtc as number) > 23) {
    throw new ContractValidationError(["body.hourUtc must be an integer between 0 and 23"]);
  }

  const rawCardIds = input.selectedContextCardIds ?? [];
  if (
    !Array.isArray(rawCardIds) ||
    rawCardIds.length > STANDING_MISSION_LIMITS.selectedContextCardIds
  ) {
    throw new ContractValidationError([
      `body.selectedContextCardIds must contain at most ${STANDING_MISSION_LIMITS.selectedContextCardIds} items`,
    ]);
  }

  return {
    goal,
    title:
      input.title === undefined || input.title === null
        ? deriveMissionTitle(goal).slice(0, STANDING_MISSION_LIMITS.title)
        : boundedString(input.title, "body.title", STANDING_MISSION_LIMITS.title),
    cadence: input.cadence,
    hourUtc: input.hourUtc as number,
    authority: mergeStandingAuthority(input.authority),
    budgetLimits: mergeStandingBudget(input.budgetMicrounits),
    selectedContextCardIds: rawCardIds.map((item, index) =>
      parseUuid(item, `body.selectedContextCardIds[${index}]`),
    ),
  };
}

export type UpdateStandingMissionBody = { enabled: boolean };

/**
 * The only thing a PATCH may change. Cadence, hour, goal, and authority are
 * deliberately immutable: editing them in place would silently change what an
 * already-approved mandate does on its next unattended run. Changing the
 * schedule means deleting this one and approving a new one.
 */
export function parseUpdateStandingMissionBody(value: unknown): UpdateStandingMissionBody {
  const input = object(value, "body");
  if (typeof input.enabled !== "boolean") {
    throw new ContractValidationError(["body.enabled must be a boolean"]);
  }
  return { enabled: input.enabled };
}

/**
 * What the API returns. Deliberately narrower than the row: the captured
 * authority and budget are policy the server applies, not something the panel
 * renders or a client may echo back.
 */
export type StandingMissionView = {
  id: string;
  goal: string;
  title: string;
  cadence: StandingCadence;
  hourUtc: number;
  enabled: boolean;
  lastSpawnedAt: string | null;
  lastRunNote: string | null;
  createdAt: string;
};
