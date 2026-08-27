import { markComposioConnectionDisconnected } from "@/core/server/composio-connection-records";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { disconnectComposioConnection } from "@/harness/adapters/composio-connections";
import { createComposioConnectionsClient } from "@/harness/adapters/composio-connections-client";
import { buildDisconnectCommand } from "../connect-request";
import { createConnectionContext } from "../shared";

/**
 * DELETE /api/integrations/composio/connections/:connectionId
 *
 * Drops one of the caller's own connections at Composio.
 *
 * The id is matched against the caller's own entity listing before anything
 * is deleted, so another user's connection id is answered with a bare 404,
 * not a 403 that would confirm the id exists and belongs to someone. An
 * unknown or malformed id is answered identically, so the endpoint reveals
 * nothing by the shape of its refusals.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const { client: supabase, principal, entityId } = await createConnectionContext();
    const parsed = buildDisconnectCommand(principal, (await params).connectionId);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.rejection.error }, { status: parsed.rejection.status });
    }

    const composio = createComposioConnectionsClient();
    if (!composio) return jsonResponse({ available: false, reason: "not_configured" });

    const result = await disconnectComposioConnection(composio, {
      entityId,
      connectionId: parsed.command.connectionId,
    });
    if (result.outcome === "not_found") {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }

    await markComposioConnectionDisconnected(supabase, {
      userId: entityId,
      connectedAccountId: parsed.command.connectionId,
    });
    return jsonResponse({ available: true, outcome: result.outcome });
  } catch (error) {
    return safeHttpError(error);
  }
}
