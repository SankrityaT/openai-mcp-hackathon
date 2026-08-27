import { randomUUID } from "node:crypto";
import { parseCreateMissionBody, readBoundedJsonBody } from "@/core/contracts/commands";
import type { JsonValue } from "@/core/contracts/types";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import {
  consumeUserMissionQuota,
  reserveGuestMissionQuota,
  reserveJudgeRunQuota,
} from "@/core/server/mission-quota";
import { createAdminMissionRepository } from "@/core/server/repository-factory";
import { readIpSignalHash } from "@/core/server/request-signals";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";

/**
 * Mission creation is the first metered write in the spine, so quota is
 * consumed server-side before any mission row exists. Without a server-only
 * credential the allowance cannot be enforced atomically, and the route fails
 * closed rather than pretending an unmetered mission was allowed.
 */
export async function POST(request: Request) {
  try {
    const body = parseCreateMissionBody(await readBoundedJsonBody(request));
    const correlationId = body.correlationId ?? randomUUID();
    const principal = await resolveMissionPrincipal();

    if (principal.kind === "anonymous") {
      throw new AuthenticationRequiredError();
    }
    if (!hasSupabaseSecretKey()) {
      return jsonResponse({ error: "quota_unavailable" }, { status: 503 });
    }

    const admin = createAdminMissionRepository();
    const mission = {
      title: body.title,
      goal: body.goal,
      constraints: body.constraints,
      authority: body.authority as unknown as JsonValue,
      selectedContextCardIds: body.selectedContextCardIds,
      budgetLimits: body.budgetLimits,
      correlationId,
    };

    if (principal.kind === "user") {
      const tenant = await principal.repository.ensureUserTenant();
      await consumeUserMissionQuota(admin, {
        tenantId: tenant.id,
        userId: principal.userId,
        correlationId,
      });
      const snapshot = await principal.repository.createMission({
        ...mission,
        tenantId: tenant.id,
        actor: { kind: "user", id: principal.userId },
      });
      return jsonResponse(snapshot, { status: 201 });
    }

    const reservation =
      principal.kind === "judge"
        ? await reserveJudgeRunQuota(admin, { codeHash: principal.codeHash })
        : await reserveGuestMissionQuota(admin, {
            sessionTokenHash: principal.sessionTokenHash,
            ipSignalHash: readIpSignalHash(request),
          });

    const snapshot = await admin.createMission({
      ...mission,
      tenantId: reservation.tenantId,
      actor: { kind: "system", id: `${principal.kind}-session` },
    });
    return jsonResponse(snapshot, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
