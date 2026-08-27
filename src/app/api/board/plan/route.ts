import { z } from "zod";
import { InternalFixtureAdapter } from "@/harness/adapters/internal-fixture";
import type { PlanningInput } from "@/harness/contracts";
import { ModelNotConfiguredError, generateMissionPlan } from "@/harness/planner";
import { layoutMissionPlan } from "@/core/board/plan-layout";
import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";

export const maxDuration = 120;

const bodySchema = z.object({
  goal: z.string().trim().min(1).max(8_000),
});

/**
 * Cardea's default read-only mandate. The board has no mandate sheet yet, so
 * the authority handed to the planner is the most restrictive one the product
 * offers: prepare freely, commit nothing. This must stay conservative — it is
 * the sentence the model treats as its permission boundary.
 */
const DEFAULT_AUTHORITY =
  "Prepare, research, compare, and draft freely. Never book, buy, sign, send, " +
  "delete, or change any account without explicit human approval first.";

const DEFAULT_APPROVAL_BOUNDARY_HINT = [
  "Any spending, booking, or payment.",
  "Any message sent on the person's behalf.",
  "Any account, credential, or permission change.",
];

/**
 * Turns a bare prompt into a laid-out mission plan for the board.
 *
 * Separate from /api/agent/plan because that route takes a fully compiled
 * PlanningInput from the mission spine, while the board only has a sentence
 * the person typed. This route owns that translation and nothing else: it
 * creates no mission row and commits no side effect, so it is safe for a guest
 * session to reach under a rate limit.
 */
export async function POST(request: Request) {
  try {
    // Real model spend sits behind this handler, so identity and rate limit
    // are settled before the body is read.
    const limited = enforceRateLimit("agent_plan", readIpSignalHash(request));
    if (limited) return limited;

    const principal = await resolveMissionPrincipal();
    if (principal.kind === "anonymous") throw new AuthenticationRequiredError();

    const parsed = bodySchema.safeParse(await readBoundedJsonBody(request, 32_768));
    if (!parsed.success) {
      throw new ContractValidationError(
        parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }

    const capabilities = await new InternalFixtureAdapter().discover();
    const input: PlanningInput = {
      goal: parsed.data.goal,
      constraints: [],
      authoritySummary: DEFAULT_AUTHORITY,
      capabilities,
    };

    const { plan } = await generateMissionPlan(input);
    const layout = layoutMissionPlan(plan);

    return jsonResponse({
      layout: {
        ...layout,
        approvalBoundaries:
          layout.approvalBoundaries.length > 0
            ? layout.approvalBoundaries
            : DEFAULT_APPROVAL_BOUNDARY_HINT,
      },
    });
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      // Degrade visibly: the board must say the planner is unavailable rather
      // than silently rendering an empty mission.
      return jsonResponse({ error: "planner_unavailable" }, { status: 503 });
    }
    return safeHttpError(error);
  }
}
