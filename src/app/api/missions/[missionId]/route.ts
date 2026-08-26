import { parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { createUserMissionRepository } from "@/core/server/repository-factory";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const missionId = parseUuid((await params).missionId, "missionId");
    const client = await createSupabaseServerClient();
    await requireAuthenticatedUser(client);
    const repository = await createUserMissionRepository();
    const mission = await repository.getMission(missionId);
    return mission
      ? jsonResponse(mission)
      : jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return safeHttpError(error);
  }
}
