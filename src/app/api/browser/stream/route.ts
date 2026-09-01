import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { RawData, WebSocket } from "ws";
import { validateNodeId } from "@/core/browser-run/ledger";
import {
  type DownstreamMessage,
  decodeUpstream,
  encodeDownstream,
  isInputMessage,
  statusMessage,
  validateTargetUrl,
} from "@/core/browser-run/protocol";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import {
  attachAndStream,
  hasBrowserRunCredentials,
  isRemoteBrowserEnabled,
  isRemoteBrowserInputEnabled,
} from "@/lib/browser-run";
import {
  ensureSharedBrowser,
  invalidateSharedBrowser,
  ledgerKeyFor,
  reapIdleSessions,
  sessionLedger,
} from "../session-registry";

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
 * Input forwarding is gated on `REMOTE_BROWSER_INPUT` being exactly "1", read
 * here and handed to the relay as a boolean. With the flag off the relay drops
 * every input message, so a client cannot talk its way into control: the
 * server decides, and the node's badge only claims takeover after the relay
 * has proven a round trip.
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

  const limited = enforceRateLimit("browser_session", readIpSignalHash(request));
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const target = validateTargetUrl(params.get("url"));
  const nodeId = validateNodeId(params.get("nodeId"));
  if (!target || !nodeId) return new Response("Bad Request", { status: 400 });
  // Every ledger touch below is namespaced to this caller's own identity, so
  // presenting another session's nodeId cannot reattach to its live tab.
  const ledgerKey = ledgerKeyFor(principal, nodeId);
  if (!ledgerKey) return new Response("Unauthorized", { status: 401 });

  await reapIdleSessions();

  return experimental_upgradeWebSocket((socket) => {
    void runRelay(socket, ledgerKey, target.href);
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

/** `nodeId` here is the caller-scoped ledger key, not the raw board node id. */
async function runRelay(socket: WebSocket, nodeId: string, targetUrl: string): Promise<void> {
  const send = (message: DownstreamMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(encodeDownstream(message));
  };

  const claim = sessionLedger.claim(nodeId, Date.now());
  if (!claim.ok) {
    // Honest refusal rather than a spinner: the operator is at the tab cap
    // and needs to close a page, not wait.
    send(statusMessage("error", "all live page slots are in use, close one first"));
    socket.close(1013, "at capacity");
    return;
  }

  let relay: ReturnType<typeof attachAndStream> | null = null;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    relay?.close();
    // The tab deliberately survives: another socket has 60s to reattach to
    // the same page before `reapIdleSessions` closes it.
    sessionLedger.release(nodeId, Date.now());
  };

  socket.on("close", release);
  socket.on("error", release);

  try {
    const browser = await ensureSharedBrowser();

    relay = attachAndStream({
      webSocketDebuggerUrl: browser.webSocketDebuggerUrl,
      targetUrl,
      existingTargetId: claim.entry.targetId || null,
      onTargetCreated: (targetId) => sessionLedger.bindTarget(nodeId, targetId),
      onUpstreamGone: (streamed) => {
        // A socket that died before ever painting almost always means the
        // shared browser itself is gone (keep_alive expiry, cold registry).
        // Forget it so the next claim builds a fresh one, then close the
        // downstream socket so the tile's own backoff retries against it.
        // A socket that streamed and then dropped retries the same browser.
        if (!streamed) void invalidateSharedBrowser();
        socket.close(1012, "upstream gone");
      },
      send,
      inputEnabled: isRemoteBrowserInputEnabled(),
    });

    socket.on("message", (raw: RawData) => {
      const command = decodeUpstream(raw.toString());
      if (!command) return;
      if (isInputMessage(command)) relay?.input(command);
      else if (command.t === "pause") relay?.pause();
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
    // A fresh reservation that never became a tab stops holding capacity; a
    // reused one gives back this socket's attach count so the grace period
    // can actually start.
    if (!claim.reused) sessionLedger.abandon(nodeId);
    else sessionLedger.release(nodeId, Date.now());
    released = true;
    socket.close(1011, "session failed");
  }
}
