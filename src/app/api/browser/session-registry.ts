import "server-only";

import { SessionLedger, type SharedBrowser } from "@/core/browser-run/ledger";
import type { MissionPrincipal } from "@/core/server/mission-principal";
import { closeSession, createSession } from "@/lib/browser-run";
import { closeTargetTab } from "@/lib/browser-run/cdp-socket";

/**
 * The one process-wide ledger of the shared Cloudflare Browser Run session
 * and its tabs, used by the relay route and the stop route.
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
 * Ledger key for one principal's claim on one board node.
 *
 * The client-supplied `nodeId` alone is not an isolation boundary: any
 * signed-in caller could present another session's node id and reattach to
 * (or close) its live tab. Prefixing the key with the caller's own stable
 * identity makes each principal's tabs invisible to every other principal
 * without changing anything about how the ledger itself works. Reattach
 * after a refresh still works, because the same person carries the same
 * identity. Never returns a key for an anonymous principal: the routes
 * refuse those before the ledger is touched.
 */
export function ledgerKeyFor(principal: MissionPrincipal, nodeId: string): string | null {
  switch (principal.kind) {
    case "user":
      return `user:${principal.userId}:${nodeId}`;
    case "judge":
      return `judge:${principal.codeHash}:${nodeId}`;
    case "guest":
      return `guest:${principal.sessionTokenHash}:${nodeId}`;
    default:
      return null;
  }
}

/**
 * Serializes browser creation: several tiles connect at once when a mission
 * opens pages, and without this each racer would create its own Cloudflare
 * session, defeating the whole one-browser design and leaking the losers.
 */
let creating: Promise<SharedBrowser> | null = null;

export async function ensureSharedBrowser(): Promise<SharedBrowser> {
  const existing = sessionLedger.getBrowser();
  if (existing) return existing;
  if (!creating) {
    creating = (async () => {
      try {
        const session = await createSession();
        sessionLedger.bindBrowser(session.sessionId, session.webSocketDebuggerUrl);
        return { sessionId: session.sessionId, webSocketDebuggerUrl: session.webSocketDebuggerUrl };
      } finally {
        creating = null;
      }
    })();
  }
  return creating;
}

/**
 * The shared browser stopped answering (keep_alive expiry, provider-side
 * close). Forget it and its tabs so the next claim builds a fresh one; the
 * HTTP close is best effort against a session that is probably already gone.
 */
export async function invalidateSharedBrowser(): Promise<void> {
  const dead = sessionLedger.invalidateBrowser();
  if (dead) await closeSession(dead.sessionId);
}

/**
 * Closes every tab whose 60 second grace period has elapsed with nothing
 * attached, and the whole browser once the last one goes. Called
 * opportunistically from the routes rather than on a timer, so an idle
 * instance is never kept awake purely to run a sweeper.
 */
export async function reapIdleSessions(now: number = Date.now()): Promise<void> {
  const { tabs, browser } = sessionLedger.reap(now);
  if (browser) {
    await closeSession(browser.sessionId);
    return;
  }
  const live = sessionLedger.getBrowser();
  if (!live || tabs.length === 0) return;
  await Promise.all(
    tabs
      .filter((tab) => tab.targetId)
      .map((tab) => closeTargetTab(live.webSocketDebuggerUrl, tab.targetId)),
  );
}
