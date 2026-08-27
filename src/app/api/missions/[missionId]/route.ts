import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { resolveMissionReadRepository } from "@/core/server/mission-principal";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const missionId = parseUuid((await params).missionId, "missionId");
    const repository = await resolveMissionReadRepository(missionId);
    if (!repository) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    const mission = await repository.getMission(missionId);
    return mission
      ? jsonResponse(mission)
      : jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return safeHttpError(error);
  }
}
