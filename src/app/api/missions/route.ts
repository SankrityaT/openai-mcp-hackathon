import { randomUUID } from "node:crypto";
import { parseCreateMissionBody, readBoundedJsonBody } from "@/core/contracts/commands";
import type { JsonValue } from "@/core/contracts/types";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { listMissionSummaries } from "@/core/server/mission-list";
import {
  resolveMissionPrincipal,
  resolvePrincipalTenantId,
} from "@/core/server/mission-principal";
import {
  consumeUserMissionQuota,
  reserveGuestMissionQuota,
  reserveJudgeRunQuota,
} from "@/core/server/mission-quota";
import { createAdminMissionRepository } from "@/core/server/repository-factory";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import type { Actor } from "@/core/contracts/types";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";

/**
 * GET /api/missions
 *
 * The caller's own recent missions, newest activity first, for the `/app`
 * workspace strip. There is no parameter that could widen it to another
 * account: a signed-in user reads through their own RLS session with no
 * tenant filter at all, and a guest or judge reads through the admin client
 * narrowed to the tenant bound to their HttpOnly session cookie. An anonymous
 * visitor has no workspaces to list and is refused rather than shown an empty
 * one, so the two are never confused.
 */
export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit("mission_list", readIpSignalHash(request));
    if (limited) return limited;

    const principal = await resolveMissionPrincipal();
    if (principal.kind === "anonymous") {
      throw new AuthenticationRequiredError();
    }

    if (principal.kind === "user") {
      const client = await createSupabaseServerClient();
      return jsonResponse({ missions: await listMissionSummaries(client) });
    }

    // A guest or judge session whose tenant no longer resolves (revoked or
    // expired) is the same answer as no session at all.
    const tenantId = await resolvePrincipalTenantId(principal);
    if (!tenantId) throw new AuthenticationRequiredError();
    const missions = await listMissionSummaries(createSupabaseAdminClient(), { tenantId });
    return jsonResponse({ missions });
  } catch (error) {
    return safeHttpError(error);
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
      return jsonResponse({
        ...snapshot,
        planning: { dispatched: false, reason: "awaiting_mandate_approval" },
      }, { status: 201 });
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
    return jsonResponse({
      ...snapshot,
      planning: { dispatched: false, reason: "awaiting_mandate_approval" },
    }, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
