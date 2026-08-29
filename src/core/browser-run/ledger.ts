/**
 * In-memory bookkeeping for the shared Cloudflare Browser Run session and the
 * board tabs inside it.
 *
 * ONE BROWSER, MANY TABS. Cloudflare's free plan allows three concurrent
 * browsers for the whole account, and the research adapter needs headroom to
 * open its own. So the board never takes more than one: every live page node
 * is a tab (a CDP target) inside a single shared browser session, and the
 * concurrency cap counts tabs, not browsers. Verified live before this
 * design was adopted: Cloudflare accepts multiple concurrent WebSocket
 * clients on one session's devtools URL, each driving its own target.
 *
 * DELIBERATE LIMIT: there is no `browser_sessions` table and no Supabase
 * migration behind this. The ledger lives in the module scope of the relay
 * route, so it is correct only for a single serverless instance. That is
 * sufficient for the demo scale this ships at: one operator, one Fluid
 * instance kept warm by the open WebSockets themselves. It is NOT correct
 * across instances or across a cold start, where the worst case is an
 * orphaned Cloudflare session that its own `keep_alive` (ten minutes, hard
 * capped by Cloudflare) reaps on its own.
 *
 * Promote this to a table only when sessions must survive a deploy or be
 * shared across instances, i.e. when a session becomes something a user has
 * invested typing into.
 *
 * Pure and clock-injected so the TTL, the reattach path, and the concurrency
 * cap are testable without timers.
 */

export type SharedBrowser = {
  sessionId: string;
  webSocketDebuggerUrl: string;
};

export type LedgerEntry = {
  nodeId: string;
  /** The CDP target (tab) this node owns, or "" until the relay creates it. */
  targetId: string;
  /** Number of live relay sockets attached to this tab. */
  attached: number;
  /** When the last socket detached, or null while at least one is attached. */
  idleSince: number | null;
  createdAt: number;
};

export type ClaimResult =
  | { ok: true; entry: LedgerEntry; reused: boolean }
  | { ok: false; reason: "at_capacity" };

export type ReapResult = {
  /** Expired tabs to close individually. Empty when the browser itself goes. */
  tabs: LedgerEntry[];
  /** Set when the last tab expired: close the whole browser instead. */
  browser: SharedBrowser | null;
};

export type TakeResult = {
  entry: LedgerEntry;
  /** Set when this was the last tab: the caller closes the whole browser. */
  browser: SharedBrowser | null;
};

/**
 * All tabs share one Cloudflare browser, so this bounds board clutter and
 * frame bandwidth rather than account concurrency. Six covers the widest
 * mission fan-out the planner produces (a comparison across four retailers
 * plus headroom) without letting a runaway loop open tabs forever.
 */
export const MAX_CONCURRENT_TABS = 6;

/**
 * Grace period between the last socket detaching and the tab being closed.
 * Long enough that a reload or a second browser tab reattaches to the same
 * page rather than paying for a fresh navigation.
 */
export const IDLE_GRACE_MS = 60_000;

export class SessionLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private browser: SharedBrowser | null = null;

  constructor(
    private readonly maxTabs: number = MAX_CONCURRENT_TABS,
    private readonly idleGraceMs: number = IDLE_GRACE_MS,
  ) {}

  size(): number {
    return this.entries.size;
  }

  get(nodeId: string): LedgerEntry | null {
    return this.entries.get(nodeId) ?? null;
  }

  getBrowser(): SharedBrowser | null {
    return this.browser;
  }

  /** Records the shared browser once it actually exists. */
  bindBrowser(sessionId: string, webSocketDebuggerUrl: string): void {
    this.browser = { sessionId, webSocketDebuggerUrl };
  }

  /**
   * Forgets the shared browser and every tab in it, because the tabs died
   * with it (keep_alive expiry, provider-side close). Returns the dead
   * browser so the caller can attempt a best-effort HTTP close.
   */
  invalidateBrowser(): SharedBrowser | null {
    const dead = this.browser;
    this.browser = null;
    this.entries.clear();
    return dead;
  }

  /**
   * Reserves a tab for `nodeId`. An existing entry is reused (attach count
   * incremented) regardless of the cap, because reattaching to a tab costs
   * nothing new. A genuinely new tab is refused once the cap is reached.
   */
  claim(nodeId: string, now: number): ClaimResult {
    const existing = this.entries.get(nodeId);
    if (existing) {
      existing.attached += 1;
      existing.idleSince = null;
      return { ok: true, entry: existing, reused: true };
    }
    if (this.entries.size >= this.maxTabs) {
      return { ok: false, reason: "at_capacity" };
    }
    const entry: LedgerEntry = {
      nodeId,
      targetId: "",
      attached: 1,
      idleSince: null,
      createdAt: now,
    };
    this.entries.set(nodeId, entry);
    return { ok: true, entry, reused: false };
  }

  /** Records the tab's CDP target once the relay has created it. */
  bindTarget(nodeId: string, targetId: string): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    entry.targetId = targetId;
  }

  /** One relay socket went away. The tab stays open for the grace period. */
  release(nodeId: string, now: number): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    entry.attached = Math.max(0, entry.attached - 1);
    if (entry.attached === 0) entry.idleSince = now;
  }

  /** Drops a reservation that never became a tab, so it stops holding capacity. */
  abandon(nodeId: string): void {
    this.entries.delete(nodeId);
  }

  /**
   * Entries whose grace period has elapsed with nothing attached. Removed
   * from the ledger as they are returned, so the caller closes each exactly
   * once. When the sweep empties the ledger, the shared browser is returned
   * (and forgotten) instead of the individual tabs, because closing the
   * browser closes everything in one call.
   */
  reap(now: number): ReapResult {
    const expired: LedgerEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.attached === 0 && entry.idleSince !== null && now - entry.idleSince >= this.idleGraceMs) {
        expired.push(entry);
      }
    }
    for (const entry of expired) this.entries.delete(entry.nodeId);

    if (expired.length > 0 && this.entries.size === 0 && this.browser) {
      const browser = this.browser;
      this.browser = null;
      return { tabs: [], browser };
    }
    return { tabs: expired, browser: null };
  }

  /**
   * Forcible close, used by the stop endpoint. Removes the entry exactly
   * once; when it was the last tab, hands back the shared browser too so the
   * caller closes the whole session rather than an empty shell.
   */
  take(nodeId: string): TakeResult | null {
    const entry = this.entries.get(nodeId);
    if (!entry) return null;
    this.entries.delete(nodeId);
    if (this.entries.size === 0 && this.browser) {
      const browser = this.browser;
      this.browser = null;
      return { entry, browser };
    }
    return { entry, browser: null };
  }
}

/**
 * A board node id from the client is untrusted. Bound it and restrict it to
 * the characters mission ids and codenames actually use, so it can never be
 * anything but a Map key.
 */
export function validateNodeId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}
