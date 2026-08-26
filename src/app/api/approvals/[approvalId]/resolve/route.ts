import {
  parseResolveApprovalBody,
  readBoundedJsonBody,
} from "@/core/contracts/commands";
import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const approvalId = parseUuid((await params).approvalId, "approvalId");
    const body = parseResolveApprovalBody(await readBoundedJsonBody(request));
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    const approval = await new SupabaseMissionRepository(client).resolveApproval({
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
