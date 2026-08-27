import { readBoundedJsonBody } from "@/core/contracts/commands";
import { parseUpdateStandingMissionBody } from "@/core/contracts/standing-missions";
import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import {
  deleteStandingMission,
  setStandingMissionEnabled,
  toStandingMissionView,
} from "@/core/server/standing-mission-records";
import { createStandingMissionContext, translateStandingMissionError } from "../shared";

/**
 * PATCH /api/standing-missions/[standingMissionId]
 *
 * Pauses or resumes one schedule. `enabled` is the only field a PATCH may
 * change: cadence, goal, and captured authority are fixed at creation, because
 * editing them in place would quietly change what an already-approved mandate
 * does on its next unattended run. Changing those means deleting this schedule
 * and approving a new one.
 *
 * A schedule belonging to another account is a 404, not a 403. The row is
 * simply not visible to this session, so the endpoint has nothing to say about
 * whether it exists.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ standingMissionId: string }> },
) {
  try {
    const limited = enforceRateLimit("standing_mission", readIpSignalHash(request));
    if (limited) return limited;

    const id = parseUuid((await params).standingMissionId, "standingMissionId");
    const body = parseUpdateStandingMissionBody(await readBoundedJsonBody(request));
    const { client, userId } = await createStandingMissionContext();
    const row = await setStandingMissionEnabled(client, { id, userId, enabled: body.enabled });
    if (!row) return jsonResponse({ error: "not_found" }, { status: 404 });
    return jsonResponse({ standingMission: toStandingMissionView(row) });
  } catch (error) {
    return safeHttpError(translateStandingMissionError(error));
  }
}

/**
 * DELETE /api/standing-missions/[standingMissionId]
 *
 * Stops the schedule for good. Missions it already opened are untouched: they
 * are ordinary missions with their own log, and deleting the schedule is not a
 * claim that they did not happen.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ standingMissionId: string }> },
) {
  try {
    const limited = enforceRateLimit("standing_mission", readIpSignalHash(request));
    if (limited) return limited;

    const id = parseUuid((await params).standingMissionId, "standingMissionId");
    const { client, userId } = await createStandingMissionContext();
    const deleted = await deleteStandingMission(client, { id, userId });
    if (!deleted) return jsonResponse({ error: "not_found" }, { status: 404 });
    return jsonResponse({ deleted: true });
  } catch (error) {
    return safeHttpError(translateStandingMissionError(error));
  }
}
