import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { RawData, WebSocket } from "ws";
import { validateNodeId } from "@/core/browser-run/ledger";
import {
  type DownstreamMessage,
  decodeUpstream,
  encodeDownstream,
  statusMessage,
  validateTargetUrl,
} from "@/core/browser-run/protocol";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import {
  attachAndStream,
  createSession,
  hasBrowserRunCredentials,
  isRemoteBrowserEnabled,
} from "@/lib/browser-run";
import { reapIdleSessions, sessionLedger } from "../session-registry";

/**
 * Same-origin WebSocket relay between a board node and a real Cloudflare
 * Browser Run headless Chrome.
 *
 *   browser tab  <-- this route -->  Cloudflare devtools (CDP)
 *
 * The end user's tab never sees Cloudflare: it holds a same-origin socket and
 * receives only the small downstream protocol from
 * `@/core/browser-run/protocol`. The Cloudflare token is attached server side
 * and never crosses this boundary.
 *
 * View only. Nothing here forwards input, and `REMOTE_BROWSER_INPUT` is
 * deliberately not consulted yet.
 *
 * Query: ?url=<http(s) target>&nodeId=<board node id>
 */

export const maxDuration = 300;

const ALLOWED_UPGRADE_HEADER = "websocket";

export async function GET(request: Request): Promise<Response> {
  // The flag is a kill switch, so a disabled deployment must not even admit
  // that this path exists.
  if (!isRemoteBrowserEnabled()) return new Response("Not Found", { status: 404 });
  if (!hasBrowserRunCredentials()) return new Response("Not Found", { status: 404 });

  if (request.headers.get("upgrade")?.toLowerCase() !== ALLOWED_UPGRADE_HEADER) {
    return new Response("Expected a WebSocket upgrade", { status: 400 });
  }
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });

  const principal = await resolveMissionPrincipal();
  if (principal.kind === "anonymous") return new Response("Unauthorized", { status: 401 });

  const params = new URL(request.url).searchParams;
  const target = validateTargetUrl(params.get("url"));
  const nodeId = validateNodeId(params.get("nodeId"));
  if (!target || !nodeId) return new Response("Bad Request", { status: 400 });

  await reapIdleSessions();

  return experimental_upgradeWebSocket((socket) => {
    void runRelay(socket, nodeId, target.href);
  });
}

/**
 * A WebSocket upgrade carries no CORS preflight, so the Origin header is the
 * only same-origin check available. A cross-site page must not be able to open
 * a browsing session on a signed-in user's cookies.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function runRelay(socket: WebSocket, nodeId: string, targetUrl: string): Promise<void> {
  const send = (message: DownstreamMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(encodeDownstream(message));
  };

  const claim = sessionLedger.claim(nodeId, Date.now());
  if (!claim.ok) {
    // Honest refusal rather than a spinner: the operator is at the concurrency
    // cap and needs to close a node, not wait.
    send(statusMessage("error", "two remote browsers are already running"));
    socket.close(1013, "at capacity");
    return;
  }

  let relay: ReturnType<typeof attachAndStream> | null = null;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    relay?.close();
    // The Cloudflare session deliberately survives: another tab has 60s to
    // reattach to the same page before `reapIdleSessions` closes it.
    sessionLedger.release(nodeId, Date.now());
  };

  socket.on("close", release);
  socket.on("error", release);

  try {
    if (!claim.entry.webSocketDebuggerUrl) {
      const session = await createSession();
      sessionLedger.bind(nodeId, session.sessionId, session.webSocketDebuggerUrl);
    }
    const entry = sessionLedger.get(nodeId);
    if (!entry?.webSocketDebuggerUrl) throw new Error("session missing after create");

    relay = attachAndStream({ webSocketDebuggerUrl: entry.webSocketDebuggerUrl, targetUrl, send });

    socket.on("message", (raw: RawData) => {
      const command = decodeUpstream(raw.toString());
      if (!command) return;
      if (command.t === "pause") relay?.pause();
      else if (command.t === "resume") relay?.resume();
      else relay?.refresh();
    });
  } catch (error) {
    // Never surface the Cloudflare body, status URL, or account id.
    send(
      statusMessage(
        "error",
        error instanceof Error && error.name === "BrowserRunApiError"
          ? "the remote browser provider refused the session"
          : "could not start a remote browser",
      ),
    );
    if (!claim.reused) sessionLedger.abandon(nodeId);
    released = true;
    socket.close(1011, "session failed");
  }
}
