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
    return safeHttpError(error);
  }
}
