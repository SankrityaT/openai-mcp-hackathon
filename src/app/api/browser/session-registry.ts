import "server-only";

import { SessionLedger } from "@/core/browser-run/ledger";
import { closeSession } from "@/lib/browser-run";

/**
 * The one process-wide ledger of Cloudflare Browser Run sessions, shared by
 * the relay route and the stop route.
 *
 * SCOPE LIMIT, stated plainly: this is module scope in a serverless function.
 * There is no `browser_sessions` table and no migration behind it. On a cold
 * start the ledger is empty and an older Cloudflare session is left to expire
 * on its own `keep_alive` (ten minutes, Cloudflare's own hard cap). Fluid
 * keeps the instance alive for as long as a WebSocket is open, so within one
 * demo this holds.
 *
 * KNOWN GAP, now that input forwarding exists: a session can hold typing a
 * user has invested, and this ledger will not carry it across a deploy or a
 * second instance. It needs to become a real table before anyone types
 * anything they would mind losing. Nothing about interactive takeover changes
 * that assessment; it only raises the stakes of it.
 */
export const sessionLedger = new SessionLedger();

/**
 * Closes every session whose 60 second grace period has elapsed with nothing
 * attached. Called opportunistically from the routes rather than on a timer,
 * so an idle instance is never kept awake purely to run a sweeper.
 */
export async function reapIdleSessions(now: number = Date.now()): Promise<void> {
  const expired = sessionLedger.reap(now);
  await Promise.all(expired.filter((e) => e.sessionId).map((e) => closeSession(e.sessionId)));
}
