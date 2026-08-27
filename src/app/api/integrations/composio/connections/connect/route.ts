import { readBoundedJsonBody } from "@/core/contracts/commands";
import { recordComposioConnection } from "@/core/server/composio-connection-records";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { startComposioConnection } from "@/harness/adapters/composio-connections";
import { createComposioConnectionsClient } from "@/harness/adapters/composio-connections-client";
import {
  buildConnectCommand,
  buildConnectionCallbackUrl,
  CONNECTION_REQUEST_LIMITS,
} from "../connect-request";
import { createConnectionContext, readAppOrigin } from "../shared";

/**
 * POST /api/integrations/composio/connections/connect
 *
 * Body: `{ toolkit }`. Starts Composio managed OAuth against the operator's
 * named auth config for that toolkit (`cardea-gmail` / `cardea-calendar`) and
 * returns the provider's redirect URL for the browser to follow.
 *
 * The Composio entity is the session's own Supabase user UUID; the body
 * cannot name an entity, so there is no shape in which user A could start a
 * connect against user B. `COMPOSIO_API_KEY` is read server-side and never
 * leaves the server, and no Google token is requested, received, or returned
 * here: the browser only ever sees a provider redirect URL.
 *
 * A repeat connect while a live connection exists returns that connection
 * with `outcome: "already_connected"` rather than an error, so a double click
 * lands on the same truthful state.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const { client: supabase, principal, entityId } = await createConnectionContext();
    const body = await readBoundedJsonBody(request, CONNECTION_REQUEST_LIMITS.maxBodyBytes);
    const parsed = buildConnectCommand(principal, body);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.rejection.error }, { status: parsed.rejection.status });
    }

    const composio = createComposioConnectionsClient();
    if (!composio) return jsonResponse({ available: false, reason: "not_configured" });

    const result = await startComposioConnection(composio, {
      entityId,
      toolkit: parsed.command.toolkit,
      callbackUrl: buildConnectionCallbackUrl(readAppOrigin(request), parsed.command.toolkit),
    });

    if (result.outcome === "auth_config_missing" || result.outcome === "no_redirect_url") {
      return jsonResponse({ available: false, reason: result.outcome });
    }
    if (result.outcome === "already_connected") {
      return jsonResponse({ available: true, outcome: result.outcome, connection: result.connection });
    }

    if (result.connection.connectionId) {
      await recordComposioConnection(supabase, {
        userId: entityId,
        toolkit: parsed.command.toolkit,
        connectedAccountId: result.connection.connectionId,
        status: result.connection.status,
      });
    }
    return jsonResponse({
      available: true,
      outcome: result.outcome,
      redirectUrl: result.redirectUrl,
      connection: result.connection,
    });
  } catch (error) {
    return safeHttpError(error);
  }
}
