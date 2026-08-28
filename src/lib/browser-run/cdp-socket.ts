import "server-only";

import { WebSocket as NodeWebSocket, type RawData } from "ws";
import { type CdpTransport, redactDevtoolsUrl } from "@/core/browser-run/protocol";
import { getBrowserRunCredentials } from "./config";

/**
 * The socket half of a one-shot CDP conversation.
 *
 * `relay.ts` owns its own long-lived `ws` socket because its lifecycle (pause,
 * resume, screencast acks, input verification) *is* the feature. A page read
 * needs none of that: it connects, exchanges a handful of commands, and hangs
 * up. Both speak the same protocol module, so this is a second socket owner,
 * not a second CDP client.
 *
 * Node 22's built-in `WebSocket` cannot set request headers and Cloudflare's
 * devtools endpoint requires `Authorization: Bearer`, which is the same reason
 * the relay reaches for `ws`.
 *
 * The token is read here and attached to the handshake. It is never returned,
 * logged, or placed in an error: connection failures report only the redacted
 * devtools URL.
 */
export function connectCdpTransport(
  webSocketDebuggerUrl: string,
  handshakeTimeoutMs = 10_000,
): Promise<CdpTransport> {
  const { token } = getBrowserRunCredentials();
  return new Promise((resolve, reject) => {
    const socket = new NodeWebSocket(webSocketDebuggerUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let settled = false;
    const messageHandlers: ((raw: string) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    const errorHandlers: ((error: Error) => void)[] = [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.terminate();
      } catch {
        // Already gone; the rejection below is the outcome that matters.
      }
      reject(
        new Error(
          `remote browser handshake timed out after ${handshakeTimeoutMs}ms: ${redactDevtoolsUrl(webSocketDebuggerUrl)}`,
        ),
      );
    }, handshakeTimeoutMs);

    socket.on("message", (raw: RawData) => {
      const text = raw.toString();
      for (const handler of messageHandlers) handler(text);
    });
    socket.on("close", () => {
      for (const handler of closeHandlers) handler();
    });
    socket.on("error", (error: Error) => {
      // Never surface the raw message: it embeds the devtools URL.
      const safe = new Error(
        `remote browser socket failed: ${redactDevtoolsUrl(webSocketDebuggerUrl)}`,
      );
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(safe);
        return;
      }
      void error;
      for (const handler of errorHandlers) handler(safe);
    });

    socket.on("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        send(payload: string) {
          if (socket.readyState !== NodeWebSocket.OPEN) return;
          socket.send(payload);
        },
        close() {
          try {
            socket.close(1000, "page read complete");
          } catch {
            socket.terminate();
          }
        },
        onMessage(handler) {
          messageHandlers.push(handler);
        },
        onClose(handler) {
          closeHandlers.push(handler);
        },
        onError(handler) {
          errorHandlers.push(handler);
        },
      });
    });
  });
}
