import {
  parseAppendEventBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    const client = await createSupabaseServerClient();
    await requireAuthenticatedUser(client);
    const events = await new SupabaseMissionRepository(client).listEvents(
      missionId,
      afterSequence,
    );
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
    const missionId = parseUuid((await params).missionId, "missionId");
    const body = parseAppendEventBody(await readBoundedJsonBody(request));
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    const event = await new SupabaseMissionRepository(client).appendEvent({
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
