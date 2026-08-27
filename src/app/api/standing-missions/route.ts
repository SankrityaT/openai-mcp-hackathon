import { readBoundedJsonBody } from "@/core/contracts/commands";
import { parseCreateStandingMissionBody } from "@/core/contracts/standing-missions";
import type { Json } from "@/core/database.types";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import {
  insertStandingMission,
  listStandingMissions,
  toStandingMissionView,
} from "@/core/server/standing-mission-records";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";
import { createStandingMissionContext, translateStandingMissionError } from "./shared";

/**
 * GET /api/standing-missions
 *
 * The caller's own standing missions. There is no parameter that could widen
 * it to another account: the owner comes from the session and the query runs
 * under that session's RLS.
 */
export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit("standing_mission", readIpSignalHash(request));
    if (limited) return limited;

    const { client, userId } = await createStandingMissionContext();
    const rows = await listStandingMissions(client, userId);
    return jsonResponse({ standingMissions: rows.map(toStandingMissionView) });
  } catch (error) {
    return safeHttpError(translateStandingMissionError(error));
  }
}

/**
 * POST /api/standing-missions
 *
 * Records a mandate the person is approving once, to be reopened on a
 * schedule. Creating the schedule costs no mission quota; each run it opens
 * costs one, debited by the sweep against the owner's own daily allowance.
 *
 * Only a signed-in account may create one. A standing mission runs unattended
 * for as long as it is enabled, so it needs an account to charge and an owner
 * to stop for; guest and judge doors exist so that no account is involved.
 *
 * The insert goes through the service role because `standing_missions` has no
 * insert policy by design: `user_id` and `tenant_id` are both server-resolved,
 * so no request body can name another account or another tenant. Without a
 * server-only credential the route fails closed rather than writing a
 * schedule it cannot bind to a tenant.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("standing_mission", readIpSignalHash(request));
    if (limited) return limited;

    const body = parseCreateStandingMissionBody(await readBoundedJsonBody(request));
    const { client, userId } = await createStandingMissionContext();
    if (!hasSupabaseSecretKey()) {
      return jsonResponse({ error: "standing_missions_unavailable" }, { status: 503 });
    }

    const tenant = await new SupabaseMissionRepository(client).ensureUserTenant();
    const row = await insertStandingMission(createSupabaseAdminClient(), {
      tenantId: tenant.id,
      userId,
      goal: body.goal,
      title: body.title,
      authority: body.authority as unknown as Json,
      budgetLimits: body.budgetLimits as unknown as Json,
      selectedContextCardIds: body.selectedContextCardIds,
      cadence: body.cadence,
      hourUtc: body.hourUtc,
    });
    return jsonResponse({ standingMission: toStandingMissionView(row) }, { status: 201 });
  } catch (error) {
    return safeHttpError(translateStandingMissionError(error));
  }
}
