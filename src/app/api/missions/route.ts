import { randomUUID } from "node:crypto";
import { parseCreateMissionBody, readBoundedJsonBody } from "@/core/contracts/commands";
import type { JsonValue } from "@/core/contracts/types";
import type { TenantRow } from "@/core/database.types";
import { RedactedDatabaseError } from "@/core/server/database";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = parseCreateMissionBody(await readBoundedJsonBody(request));
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    const tenantResult = await client.rpc("ensure_user_tenant", {
      p_display_name: "Personal",
    });
    if (tenantResult.error || !tenantResult.data) {
      throw new RedactedDatabaseError(tenantResult.error?.code);
    }
    const tenant = tenantResult.data as unknown as TenantRow;
    const repository = new SupabaseMissionRepository(client);
    const snapshot = await repository.createMission({
      tenantId: tenant.id,
      title: body.title,
      goal: body.goal,
      constraints: body.constraints,
      authority: body.authority as unknown as JsonValue,
      selectedContextCardIds: body.selectedContextCardIds,
      budgetLimits: body.budgetLimits,
      actor: { kind: "user", id: userId },
      correlationId: body.correlationId ?? randomUUID(),
    });
    return jsonResponse(snapshot, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
