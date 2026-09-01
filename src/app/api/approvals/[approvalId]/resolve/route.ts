import {
  parseResolveApprovalBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { resolveMissionWriteContext } from "@/core/server/mission-principal";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { sendApprovalResolved } from "@/harness/inngest/dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const limited = enforceRateLimit("approval_resolve", readIpSignalHash(request));
    if (limited) return limited;

    const approvalId = parseUuid((await params).approvalId, "approvalId");
    const body = parseResolveApprovalBody(await readBoundedJsonBody(request));
    const context = await resolveMissionWriteContext(body.missionId);
    if (!context) return jsonResponse({ error: "not_found" }, { status: 404 });
    const { repository, actor } = context;
    // The write context only proves the caller may write `body.missionId`.
    // The approval id from the path must actually belong to that mission,
    // or a caller could settle another mission's approval through the
    // service-role path a guest/judge session uses.
    const approvalMissionId = await repository.getApprovalMissionId(approvalId);
    if (approvalMissionId !== body.missionId) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    const approval = await repository.resolveApproval({
      approvalId,
      decision: body.decision,
      resolution: body.resolution,
      actor,
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
        actor,
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
