import { validateNodeId } from "@/core/browser-run/ledger";
import { jsonResponse } from "@/core/server/http";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import { closeSession, hasBrowserRunCredentials, isRemoteBrowserEnabled } from "@/lib/browser-run";
import { reapIdleSessions, sessionLedger } from "../session-registry";

/**
 * Closes a node's Cloudflare Browser Run session immediately, skipping the 60
 * second reattach grace period the relay socket's own close would honour.
 *
 * Same auth as the relay: a Cardea principal, never anonymous. Closing is
 * idempotent, so a repeat call for an unknown node is a success with
 * `closed: false` rather than an error a caller has to special case.
 *
 * Body: {"nodeId": "..."}
 */
export async function POST(request: Request): Promise<Response> {
  if (!isRemoteBrowserEnabled() || !hasBrowserRunCredentials()) {
    return new Response("Not Found", { status: 404 });
  }

  const principal = await resolveMissionPrincipal();
  if (principal.kind === "anonymous") {
    return jsonResponse({ error: "authentication_required" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const nodeId =
    typeof body === "object" && body !== null
      ? validateNodeId((body as Record<string, unknown>).nodeId as string | undefined)
      : null;
  if (!nodeId) return jsonResponse({ error: "invalid_request" }, { status: 400 });

  const entry = sessionLedger.take(nodeId);
  const closed = entry?.sessionId ? await closeSession(entry.sessionId) : false;
  await reapIdleSessions();
  return jsonResponse({ closed });
}
