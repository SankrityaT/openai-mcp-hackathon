import "server-only";

import { WebSocket as NodeWebSocket, type RawData } from "ws";
import {
  type CdpTransport,
  createCdpEncoder,
  decodeCdpMessage,
  encodeCdpCommand,
  redactDevtoolsUrl,
} from "@/core/browser-run/protocol";
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

/**
 * Closes one tab (CDP target) inside the shared browser, leaving the browser
 * and every other tab running. A one-shot conversation: connect, send
 * `Target.closeTarget`, hang up. Never throws, because a tab that fails to
 * close is a leak the browser's own lifecycle will absorb, and it must not
 * mask whatever the caller was doing.
 */
export async function closeTargetTab(
  webSocketDebuggerUrl: string,
  targetId: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  try {
    const transport = await connectCdpTransport(webSocketDebuggerUrl, timeoutMs);
    const encoder = createCdpEncoder();
    const command = encoder.command("Target.closeTarget", { targetId });
    return await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        transport.close();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      transport.onMessage((raw) => {
        const message = decodeCdpMessage(raw);
        if (!message || message.kind === "event") return;
        if (message.id !== command.id) return;
        finish(message.kind === "result");
      });
      transport.onClose(() => finish(false));
      transport.onError(() => finish(false));
      transport.send(encodeCdpCommand(command));
    });
  } catch {
    return false;
  }
}
