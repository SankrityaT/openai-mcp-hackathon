import "server-only";

import { type DownstreamMessage, validateTargetUrl } from "@/core/browser-run/protocol";
import { closeSession, createSession } from "./cloudflare";
import { hasBrowserRunCredentials, isRemoteBrowserEnabled } from "./config";
import { attachAndStream } from "./relay";

export { BrowserRunApiError, closeSession, createSession, describeSession } from "./cloudflare";
export type { BrowserRunSession } from "./cloudflare";
export {
  BrowserRunNotConfiguredError,
  hasBrowserRunCredentials,
  isRemoteBrowserEnabled,
  isRemoteBrowserInputEnabled,
} from "./config";
export { attachAndStream } from "./relay";
export type { RelayHandle, RelayOptions } from "./relay";

export type SelfTestReport = {
  ok: boolean;
  /** Every step attempted, in order, with its outcome. Never contains a token. */
  steps: string[];
  /** Downstream messages observed, with frame payloads reduced to their size. */
  observed: string[];
  framesReceived: number;
};

/**
 * Operator smoke test. Nothing calls this automatically: it exists so that,
 * once a valid `CLOUDFLARE_BROWSER_TOKEN` is in place, one round trip can be
 * proven end to end from a server context without a board, a node, or a
 * browser tab.
 *
 * It creates a real Cloudflare session, attaches, navigates, waits for frames,
 * and always closes the session before returning, including on failure. Run it
 * from a temporary server action or route handler; do not ship a caller.
 */
export async function selfTest(
  targetUrl = "https://example.com",
  waitMs = 8_000,
): Promise<SelfTestReport> {
  const steps: string[] = [];
  const observed: string[] = [];
  let framesReceived = 0;

  if (!isRemoteBrowserEnabled()) {
    return { ok: false, steps: ["REMOTE_BROWSER_ENABLED is not \"1\""], observed, framesReceived };
  }
  if (!hasBrowserRunCredentials()) {
    return {
      ok: false,
      steps: ["CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_BROWSER_TOKEN is missing"],
      observed,
      framesReceived,
    };
  }
  const url = validateTargetUrl(targetUrl);
  if (!url) {
    return { ok: false, steps: ["target url rejected"], observed, framesReceived };
  }

  let sessionId: string | null = null;
  try {
    const session = await createSession();
    sessionId = session.sessionId;
    steps.push("session created");

    const handle = attachAndStream({
      webSocketDebuggerUrl: session.webSocketDebuggerUrl,
      targetUrl: url.href,
      send: (message: DownstreamMessage) => {
        if (message.t === "frame") {
          framesReceived += 1;
          observed.push(`frame seq=${message.seq} ${message.w}x${message.h} bytes=${message.data.length}`);
          return;
        }
        observed.push(
          message.t === "status"
            ? `status ${message.state}${message.detail ? ` (${message.detail})` : ""}`
            : `nav ${message.url}`,
        );
      },
    });
    steps.push("relay attached");

    await new Promise((resolve) => setTimeout(resolve, waitMs));
    handle.close();
    steps.push(`waited ${waitMs}ms, received ${framesReceived} frame(s)`);
    return { ok: framesReceived > 0, steps, observed, framesReceived };
  } catch (error) {
    steps.push(error instanceof Error ? `failed: ${error.name}` : "failed: unknown error");
    return { ok: false, steps, observed, framesReceived };
  } finally {
    if (sessionId) {
      const closedOk = await closeSession(sessionId);
      steps.push(closedOk ? "session closed" : "session close reported a failure");
    }
  }
}
