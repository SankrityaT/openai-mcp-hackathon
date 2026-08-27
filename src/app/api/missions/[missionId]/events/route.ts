import {
  assertUserAppendableEvent,
  parseAppendEventBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { createAuthenticatedMissionRepository } from "@/core/server/repository-factory";
import { readIpSignalHash } from "@/core/server/request-signals";

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
    const { repository } = await createAuthenticatedMissionRepository();
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
    const { repository, userId } = await createAuthenticatedMissionRepository();
    const event = await repository.appendEvent({
      missionId,
      nodeId: body.nodeId,
      expectedSequence: body.expectedSequence,
      type: body.type,
      actor: { kind: "user", id: userId },
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
    return jsonResponse(event, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
