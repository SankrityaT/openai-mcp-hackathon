import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { listComposioConnections } from "@/harness/adapters/composio-connections";
import { createComposioConnectionsClient } from "@/harness/adapters/composio-connections-client";
import { createConnectionContext } from "./shared";

/**
 * GET /api/integrations/composio/connections
 *
 * The caller's own Gmail and Google Calendar connection status, one entry per
 * offered toolkit. Scoped to the session's entity, so there is no parameter
 * that could widen it to another user, and the response carries only
 * `{ toolkit, label, status, connectionId, connectedAt }` — never a token, a
 * scope grant, or a raw provider payload.
 */
export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const { entityId } = await createConnectionContext();
    const client = createComposioConnectionsClient();
    if (!client) return jsonResponse({ available: false, reason: "not_configured" });

    return jsonResponse({
      available: true,
      connections: await listComposioConnections(client, entityId),
    });
  } catch (error) {
    return safeHttpError(error);
  }
}
