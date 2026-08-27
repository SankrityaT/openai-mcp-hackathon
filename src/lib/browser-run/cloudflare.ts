import "server-only";

import { redactDevtoolsUrl } from "@/core/browser-run/protocol";
import { KEEP_ALIVE_MS, browserRunBaseUrl, getBrowserRunCredentials } from "./config";

/**
 * Cloudflare Browser Run session management over its HTTP API.
 *
 * POST   /browser-rendering/devtools/browser              creates a session
 * DELETE /browser-rendering/devtools/browser/{sessionId}  closes one
 *
 * The create response carries the `webSocketDebuggerUrl` the relay then
 * attaches to. Reconnecting to an existing session is just reusing that URL,
 * which is why `SessionLedger` stores it verbatim.
 *
 * Errors from here are deliberately thin. The Cloudflare response body can
 * contain the account id and echo request details, so only the HTTP status is
 * surfaced and any URL is redacted first.
 */

export type BrowserRunSession = {
  sessionId: string;
  webSocketDebuggerUrl: string;
};

export class BrowserRunApiError extends Error {
  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`Cloudflare Browser Run ${operation} failed with status ${status}`);
    this.name = "BrowserRunApiError";
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Creates a headless Chrome session. `keep_alive` is the maximum Cloudflare
 * permits, so a session outlives a brief disconnect without any server-side
 * heartbeat of our own.
 */
export async function createSession(signal?: AbortSignal): Promise<BrowserRunSession> {
  const { accountId, token } = getBrowserRunCredentials();
  const response = await fetch(
    `${browserRunBaseUrl(accountId)}/devtools/browser?keep_alive=${KEEP_ALIVE_MS}`,
    { method: "POST", headers: authHeaders(token), signal },
  );
  if (!response.ok) throw new BrowserRunApiError(response.status, "session create");

  const body: unknown = await response.json().catch(() => null);
  const session = readSession(body);
  if (!session) throw new BrowserRunApiError(response.status, "session create (unreadable body)");
  return session;
}

/**
 * Closes a session. Never throws: a close that fails is a leak Cloudflare's
 * own `keep_alive` will reap, and it must not mask the reason the caller was
 * shutting down in the first place.
 */
export async function closeSession(sessionId: string): Promise<boolean> {
  try {
    const { accountId, token } = getBrowserRunCredentials();
    const response = await fetch(
      `${browserRunBaseUrl(accountId)}/devtools/browser/${encodeURIComponent(sessionId)}`,
      { method: "DELETE", headers: authHeaders(token) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Cloudflare wraps successful payloads in `{success, result}`; some endpoints
 * return the object bare. Accept either rather than guessing wrong at 3am.
 */
function readSession(body: unknown): BrowserRunSession | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Record<string, unknown>;
  const candidate =
    typeof envelope.result === "object" && envelope.result !== null
      ? (envelope.result as Record<string, unknown>)
      : envelope;

  const sessionId = candidate.sessionId ?? candidate.id;
  const debuggerUrl = candidate.webSocketDebuggerUrl ?? candidate.webSocketDebuggerURL;
  if (typeof sessionId !== "string" || typeof debuggerUrl !== "string") return null;
  if (!debuggerUrl.startsWith("ws://") && !debuggerUrl.startsWith("wss://")) return null;
  return { sessionId, webSocketDebuggerUrl: debuggerUrl };
}

/** Safe rendering of a devtools URL for an operator-facing message. */
export function describeSession(session: BrowserRunSession): string {
  return redactDevtoolsUrl(session.webSocketDebuggerUrl);
}
