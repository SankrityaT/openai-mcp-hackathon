import { randomUUID } from "node:crypto";
import { parseCreateMissionBody, readBoundedJsonBody } from "@/core/contracts/commands";
import type { JsonValue } from "@/core/contracts/types";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { createAuthenticatedMissionRepository } from "@/core/server/repository-factory";

export async function POST(request: Request) {
  try {
    const body = parseCreateMissionBody(await readBoundedJsonBody(request));
    const { repository, userId } = await createAuthenticatedMissionRepository();
    const tenant = await repository.ensureUserTenant();
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
