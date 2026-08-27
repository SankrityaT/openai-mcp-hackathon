import { generateMissionPlan } from "@/harness/planner";
import type { PlanningInput } from "@/harness/contracts";
import { readBoundedJsonBody } from "@/core/contracts/commands";
import { jsonResponse, safeHttpError } from "@/core/server/http";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = (await readBoundedJsonBody(request, 196_608)) as PlanningInput;
    const result = await generateMissionPlan(input);
    return jsonResponse(result);
  } catch (error) {
    // Redacted operational breadcrumb: provider failures otherwise surface
    // only as an opaque internal_error, which makes model/config outages in
    // production undiagnosable. Never includes credentials or payloads.
    const detail = error as { name?: string; statusCode?: number; message?: string };
    console.error(
      "plan_route_error",
      detail?.name ?? "unknown",
      detail?.statusCode ?? "",
      String(detail?.message ?? "").slice(0, 300),
    );
    return safeHttpError(error);
  }
}
