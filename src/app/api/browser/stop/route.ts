import { validateNodeId } from "@/core/browser-run/ledger";
import { jsonResponse } from "@/core/server/http";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import { closeSession, hasBrowserRunCredentials, isRemoteBrowserEnabled } from "@/lib/browser-run";
import { closeTargetTab } from "@/lib/browser-run/cdp-socket";
import { reapIdleSessions, sessionLedger } from "../session-registry";

/**
 * Closes a node's tab in the shared browser immediately, skipping the 60
 * second reattach grace period the relay socket's own close would honour.
 * When it is the last tab, the whole Cloudflare session goes with it.
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

  const removed = sessionLedger.take(nodeId);
  let closed = false;
  if (removed?.browser) {
    closed = await closeSession(removed.browser.sessionId);
  } else if (removed?.entry.targetId) {
    const live = sessionLedger.getBrowser();
    if (live) closed = await closeTargetTab(live.webSocketDebuggerUrl, removed.entry.targetId);
  }
  await reapIdleSessions();
  return jsonResponse({ closed });
}
