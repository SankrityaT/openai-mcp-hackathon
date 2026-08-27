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
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import type { Actor, MissionSnapshot } from "@/core/contracts/types";
import { sendMissionRequested } from "@/harness/inngest/dispatch";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";

type PlanningDispatch =
  | { dispatched: true; ids: string[] }
  | { dispatched: false; reason: "not_configured" | "dispatch_failed" };

/**
 * Mission creation must survive a planning-dispatch failure: the mission is
 * already durable, so a broken Inngest path degrades to a truthful
 * `dispatched: false` in the response instead of failing the request.
 */
async function dispatchPlanning(
  snapshot: MissionSnapshot,
  tenantId: string,
  actor: Actor,
  correlationId: string,
): Promise<PlanningDispatch> {
  try {
    return await sendMissionRequested({
      missionId: snapshot.mission.id,
      tenantId,
      goal: snapshot.mandate.goal,
      constraints: snapshot.mandate.constraints,
      authority: snapshot.mandate.authority,
      selectedContextCardIds: snapshot.mandate.selectedContextCardIds,
      budgetLimits: snapshot.mission.budgetLimits,
      mandateVersion: snapshot.mandate.version,
      expectedSequence: snapshot.latestSequence + 1,
      actor,
      correlationId,
    });
  } catch {
    return { dispatched: false, reason: "dispatch_failed" };
  }
}

/**
 * Mission creation is the first metered write in the spine, so quota is
 * consumed server-side before any mission row exists. Without a server-only
 * credential the allowance cannot be enforced atomically, and the route fails
 * closed rather than pretending an unmetered mission was allowed.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("mission_create", readIpSignalHash(request));
    if (limited) return limited;

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
      const actor: Actor = { kind: "user", id: principal.userId };
      const snapshot = await principal.repository.createMission({
        ...mission,
        tenantId: tenant.id,
        actor,
      });
      const planning = await dispatchPlanning(snapshot, tenant.id, actor, correlationId);
      return jsonResponse({ ...snapshot, planning }, { status: 201 });
    }

    const reservation =
      principal.kind === "judge"
        ? await reserveJudgeRunQuota(admin, { codeHash: principal.codeHash })
        : await reserveGuestMissionQuota(admin, {
            sessionTokenHash: principal.sessionTokenHash,
            ipSignalHash: readIpSignalHash(request),
          });

    const guestActor: Actor = { kind: "system", id: `${principal.kind}-session` };
    const snapshot = await admin.createMission({
      ...mission,
      tenantId: reservation.tenantId,
      actor: guestActor,
    });
    const planning = await dispatchPlanning(
      snapshot,
      reservation.tenantId,
      guestActor,
      correlationId,
    );
    return jsonResponse({ ...snapshot, planning }, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
