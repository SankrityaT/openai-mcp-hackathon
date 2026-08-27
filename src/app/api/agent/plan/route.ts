import { z } from "zod";
import { generateMissionPlan } from "@/harness/planner";
import type { PlanningInput } from "@/harness/contracts";
import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";

export const maxDuration = 120;

/**
 * The body previously went into the planner as a blind cast, so any missing
 * field surfaced as an opaque 500 deep inside context compilation. Validate
 * the load-bearing shape here and fail as a 400 instead.
 */
const planningBodySchema = z.object({
  goal: z.string().min(1).max(8_000),
  constraints: z.array(z.unknown()).max(100),
  authoritySummary: z.string().min(1).max(4_000),
  capabilities: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        description: z.string().max(2_000).default(""),
      }).passthrough(),
    )
    .max(200),
  evidence: z.array(z.unknown()).max(200).optional(),
  memories: z.array(z.unknown()).max(200).optional(),
  selectedContextCardIds: z.array(z.string().max(200)).max(100).optional(),
  budget: z.record(z.string(), z.unknown()).optional(),
  escalation: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = planningBodySchema.safeParse(await readBoundedJsonBody(request, 196_608));
    if (!parsed.success) {
      throw new ContractValidationError(
        parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    const input = parsed.data as unknown as PlanningInput;
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
