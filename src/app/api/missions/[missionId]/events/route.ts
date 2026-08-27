import {
  assertUserAppendableEvent,
  parseAppendEventBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import {
  resolveMissionReadRepository,
  resolveMissionWriteContext,
} from "@/core/server/mission-principal";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { sendMissionRequested } from "@/harness/inngest/dispatch";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const missionId = parseUuid((await params).missionId, "missionId");
    const afterValue = new URL(request.url).searchParams.get("after") ?? "0";
    const afterSequence = Number(afterValue);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ContractValidationError(["after must be a non-negative integer"]);
    }
    const repository = await resolveMissionReadRepository(missionId);
    if (!repository) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    const events = await repository.listEvents(missionId, afterSequence);
    return jsonResponse({ events });
  } catch (error) {
    return safeHttpError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const limited = enforceRateLimit("event_append", readIpSignalHash(request));
    if (limited) return limited;

    const missionId = parseUuid((await params).missionId, "missionId");
    const body = assertUserAppendableEvent(
      parseAppendEventBody(await readBoundedJsonBody(request)),
    );
    const context = await resolveMissionWriteContext(missionId);
    if (!context) return jsonResponse({ error: "not_found" }, { status: 404 });
    const { repository, actor, identityId } = context;
    const event = await repository.appendEvent({
      missionId,
      nodeId: body.nodeId,
      expectedSequence: body.expectedSequence,
      type: body.type,
      actor,
      correlationId: body.correlationId,
      causationId: body.causationId,
      idempotencyKey: body.idempotencyKey,
      payload: body.payload,
      trust: body.trust,
      materialization: {
        missionStatus: body.missionStatus,
        nodeId: body.nodeId,
        nodeStatus: body.nodeStatus,
      },
    });
    let planning:
      | { dispatched: true; ids: string[] }
      | { dispatched: false; reason: "not_configured" | "dispatch_failed" }
      | undefined;
    if (body.type === "mandate.approved") {
      const snapshot = await repository.getMission(missionId);
      if (snapshot) {
        try {
          planning = await sendMissionRequested({
            missionId,
            tenantId: snapshot.mission.tenantId,
            identityId,
            goal: snapshot.mandate.goal,
            constraints: snapshot.mandate.constraints,
            authority: snapshot.mandate.authority,
            selectedContextCardIds: snapshot.mandate.selectedContextCardIds,
            budgetLimits: snapshot.mission.budgetLimits,
            mandateVersion: snapshot.mandate.version,
            expectedSequence: snapshot.latestSequence,
            actor,
            correlationId: body.correlationId,
          });
        } catch {
          planning = { dispatched: false, reason: "dispatch_failed" };
        }
      }
    }
    return jsonResponse({ ...event, ...(planning ? { planning } : {}) }, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
