/**
 * Structured quota denial contract shared by server routes and clients.
 *
 * The database raises `P0001` for an exhausted usage window, guest mission
 * allowance, or judge run allowance. Routes translate that redacted code into
 * this explicit shape so a caller can distinguish "you are out of allowance"
 * from a generic failure without leaking database internals.
 */

export type QuotaSubjectScope = "user" | "guest" | "judge" | "mission" | "node" | "provider";

export type QuotaDenialCode = "quota_exhausted" | "cost_budget_exhausted";

export const QUOTA_DENIED_ERROR = "quota_denied" as const;
export const QUOTA_DENIED_STATUS = 429;

/** Database error code raised by consume_usage, reserve_guest_mission, reserve_judge_run. */
export const QUOTA_DATABASE_ERROR_CODE = "P0001";

export type QuotaDenial = {
  error: typeof QUOTA_DENIED_ERROR;
  code: QuotaDenialCode;
  scope: QuotaSubjectScope;
  metric: string;
  limit: number | null;
  used: number | null;
  retryAfterSeconds: number | null;
};

export class QuotaDeniedError extends Error {
  readonly denial: QuotaDenial;

  constructor(denial: QuotaDenial) {
    super(`Quota denied for ${denial.scope}:${denial.metric}`);
    this.name = "QuotaDeniedError";
    this.denial = denial;
  }
}

export function buildQuotaDenial(input: {
  scope: QuotaSubjectScope;
  metric: string;
  code?: QuotaDenialCode;
  limit?: number | null;
  used?: number | null;
  retryAfterSeconds?: number | null;
}): QuotaDenial {
  return {
    error: QUOTA_DENIED_ERROR,
    code: input.code ?? "quota_exhausted",
    scope: input.scope,
    metric: input.metric,
    limit: typeof input.limit === "number" ? input.limit : null,
    used: typeof input.used === "number" ? input.used : null,
    retryAfterSeconds:
      typeof input.retryAfterSeconds === "number" ? input.retryAfterSeconds : null,
  };
}

export function isQuotaDatabaseErrorCode(code: string | undefined | null): boolean {
  return code === QUOTA_DATABASE_ERROR_CODE;
}

/**
 * Maps a redacted database error code onto a quota denial. Returns null for any
 * other failure so callers keep their existing redacted error handling.
 */
export function mapDatabaseErrorToQuotaDenial(input: {
  code: string | undefined | null;
  scope: QuotaSubjectScope;
  metric: string;
  limit?: number | null;
  used?: number | null;
}): QuotaDenial | null {
  if (!isQuotaDatabaseErrorCode(input.code)) return null;
  return buildQuotaDenial({
    scope: input.scope,
    metric: input.metric,
    limit: input.limit,
    used: input.used,
  });
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const scopes: readonly QuotaSubjectScope[] = [
  "user",
  "guest",
  "judge",
  "mission",
  "node",
  "provider",
];

const codes: readonly QuotaDenialCode[] = ["quota_exhausted", "cost_budget_exhausted"];

/**
 * Client-side parser. Accepts an HTTP status plus a decoded body and returns a
 * quota denial only when the response really is one.
 */
export function parseQuotaDenial(status: number, body: unknown): QuotaDenial | null {
  if (status !== QUOTA_DENIED_STATUS) return null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  if (source.error !== QUOTA_DENIED_ERROR) return null;

  const scope = scopes.includes(source.scope as QuotaSubjectScope)
    ? (source.scope as QuotaSubjectScope)
    : "user";
  const code = codes.includes(source.code as QuotaDenialCode)
    ? (source.code as QuotaDenialCode)
    : "quota_exhausted";
  const metric =
    typeof source.metric === "string" && source.metric.length > 0 && source.metric.length <= 120
      ? source.metric
      : "unknown";

  return buildQuotaDenial({
    scope,
    code,
    metric,
    limit: readNumber(source, "limit"),
    used: readNumber(source, "used"),
    retryAfterSeconds: readNumber(source, "retryAfterSeconds"),
  });
}

/** Bounded, user-safe sentence describing a denial. */
export function describeQuotaDenial(denial: QuotaDenial): string {
  const allowance =
    denial.limit === null ? "the configured allowance" : `${denial.limit} per window`;
  return denial.code === "cost_budget_exhausted"
    ? `The ${denial.scope} cost budget for ${denial.metric} is exhausted (${allowance}).`
    : `The ${denial.scope} allowance for ${denial.metric} is exhausted (${allowance}).`;
}
