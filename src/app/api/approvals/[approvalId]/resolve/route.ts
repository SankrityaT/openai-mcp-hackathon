import {
  parseResolveApprovalBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { createAuthenticatedMissionRepository } from "@/core/server/repository-factory";
import { sendApprovalResolved } from "@/harness/inngest/dispatch";

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

    // The RPC already appended `approval.resolved`; this send only wakes any
    // suspended `waitForApproval` step. The approval is durably settled
    // either way, so a dispatch failure degrades to `dispatched: false`
    // rather than failing the request.
    let resume: Awaited<ReturnType<typeof sendApprovalResolved>>;
    try {
      resume = await sendApprovalResolved({
        approvalId: approval.id,
        missionId: approval.missionId,
        tenantId: approval.tenantId,
        decision: body.decision,
        resolution: approval.resolution ?? null,
        actor: { kind: "user", id: userId },
        correlationId: body.correlationId,
      });
    } catch {
      resume = { dispatched: false, reason: "not_configured" };
    }
    return jsonResponse({ ...approval, resume });
  } catch (error) {
    return safeHttpError(error);
  }
}
