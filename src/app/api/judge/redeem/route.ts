import { parseJudgeRedeemBody, readBoundedJsonBody } from "@/core/contracts/commands";
import { matchesJudgeCode } from "@/core/server/credentials";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import {
  ensureJudgeAccess,
  getConfiguredJudgeCodeHash,
  isJudgeRedemptionEnabled,
} from "@/core/server/judge-access";
import { writeJudgeAccessCookie } from "@/core/server/session-cookies";

const MAX_BODY_BYTES = 4_096;

/**
 * Redeems a judge code.
 *
 * The submitted code is compared in constant time against `CARDEA_JUDGE_CODE_HASH`.
 * Only hashes are ever stored or compared, and the code is never echoed back.
 * On success the session is bound to judge access through a signed HttpOnly
 * cookie; individual runs are reserved per mission through `reserve_judge_run`,
 * bounded by the stored maximum of ten.
 *
 * When judge access is not configured the route reports `not_found`, so a
 * deployment without judge access does not advertise the capability.
 */
export async function POST(request: Request) {
  try {
    if (!isJudgeRedemptionEnabled()) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    const expectedHash = getConfiguredJudgeCodeHash();
    const body = parseJudgeRedeemBody(await readBoundedJsonBody(request, MAX_BODY_BYTES));

    if (!matchesJudgeCode(body.code, expectedHash)) {
      return jsonResponse({ error: "invalid_code" }, { status: 403 });
    }

    const allowance = await ensureJudgeAccess(expectedHash as string);
    await writeJudgeAccessCookie(expectedHash as string);
    return jsonResponse({
      judge: true,
      used: allowance.used,
      limit: allowance.limit,
      remaining: Math.max(allowance.limit - allowance.used, 0),
    });
  } catch (error) {
    return safeHttpError(error);
  }
}
