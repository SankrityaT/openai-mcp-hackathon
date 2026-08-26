import {
  parseResolveApprovalBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { createAuthenticatedMissionRepository } from "@/core/server/repository-factory";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const approvalId = parseUuid((await params).approvalId, "approvalId");
    const body = parseResolveApprovalBody(await readBoundedJsonBody(request));
    const { repository, userId } = await createAuthenticatedMissionRepository();
    const approval = await repository.resolveApproval({
      approvalId,
      decision: body.decision,
      resolution: body.resolution,
      actor: { kind: "user", id: userId },
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
    return jsonResponse(approval);
  } catch (error) {
    return safeHttpError(error);
  }
}
