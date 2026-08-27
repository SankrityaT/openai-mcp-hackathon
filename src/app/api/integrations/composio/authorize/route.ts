import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { initiateComposioAuthorization, isComposioToolkit, type ComposioToolkit } from "@/harness/adapters/composio";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseAuthorizeBody(value: unknown): {
  toolkit: ComposioToolkit;
  missionId?: string;
  nodeId?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError(["body must be an object"]);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.toolkit !== "string" || !isComposioToolkit(input.toolkit)) {
    throw new ContractValidationError(["body.toolkit is not an allowed value"]);
  }
  const missionId =
    input.missionId === undefined ? undefined : parseUuid(input.missionId, "body.missionId");
  const nodeId = input.nodeId === undefined ? undefined : parseUuid(input.nodeId, "body.nodeId");
  if (nodeId && !missionId) {
    throw new ContractValidationError(["body.missionId is required when body.nodeId is present"]);
  }
  return { toolkit: input.toolkit, missionId, nodeId };
}

/**
 * POST /api/integrations/composio/authorize
 *
 * Body: `{ toolkit }`, restricted to the allowed toolkit list.
 *
 * Authenticated. Creates a mission-scoped Composio session for exactly the
 * requested toolkit, signs a short-lived state token (HMAC over
 * user + toolkit + session + timestamp, `CARDEA_STATE_SECRET`), and returns
 * `{ available, redirectUrl }`. Never returns a provider token; the state
 * token is embedded server-side in the callback URL Composio redirects
 * back to, not exposed to the caller.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const body = parseAuthorizeBody(await readBoundedJsonBody(request, 2_048));
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);

    const appOrigin = process.env.CARDEA_APP_ORIGIN;
    if (!appOrigin) {
      return jsonResponse({ available: false, reason: "not_configured" });
    }
    const callbackBaseUrl = new URL("/api/integrations/composio/callback", appOrigin).toString();

    const result = await initiateComposioAuthorization({
      userId,
      toolkit: body.toolkit,
      callbackBaseUrl,
      missionId: body.missionId,
      nodeId: body.nodeId,
    });
    return jsonResponse(result);
  } catch (error) {
    return safeHttpError(error);
  }
}
