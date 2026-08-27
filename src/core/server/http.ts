import "server-only";

import { QuotaDeniedError, QUOTA_DENIED_STATUS } from "../contracts/quota-errors";
import { ContractValidationError } from "../contracts/validation";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { RedactedDatabaseError } from "./database";

export function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return Response.json(value, { ...init, headers });
}

export function safeHttpError(error: unknown) {
  if (error instanceof ContractValidationError) {
    return jsonResponse({ error: "invalid_request", issues: error.issues }, { status: 400 });
  }
  if (error instanceof AuthenticationRequiredError) {
    return jsonResponse({ error: "authentication_required" }, { status: 401 });
  }
  if (error instanceof QuotaDeniedError) {
    const headers =
      error.denial.retryAfterSeconds === null
        ? undefined
        : { "Retry-After": String(error.denial.retryAfterSeconds) };
    return jsonResponse(error.denial, { status: QUOTA_DENIED_STATUS, headers });
  }
  if (error instanceof RedactedDatabaseError) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "55000" || error.code === "40001" || error.code === "23505"
          ? 409
          : error.code === "22023"
            ? 400
            : error.code === "P0001"
              ? 429
              : 500;
    return jsonResponse({ error: error.code }, { status });
  }
  return jsonResponse({ error: "internal_error" }, { status: 500 });
}
