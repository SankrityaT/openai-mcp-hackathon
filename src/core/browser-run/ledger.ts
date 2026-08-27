/**
 * In-memory bookkeeping for Cloudflare Browser Run sessions, keyed by board
 * node id.
 *
 * DELIBERATE LIMIT: there is no `browser_sessions` table and no Supabase
 * migration behind this. The ledger lives in the module scope of the relay
 * route, so it is correct only for a single serverless instance. That is
 * sufficient for the frames-only, view-only demo scale this ships at: one
 * operator, a couple of nodes, one Fluid instance kept warm by the open
 * WebSocket itself. It is NOT correct across instances or across a cold
 * start, where the worst case is an orphaned Cloudflare session that its own
 * `keep_alive` (ten minutes, hard capped by Cloudflare) reaps on its own.
 *
 * Promote this to a table only when sessions must survive a deploy or be
 * shared across instances, i.e. when input forwarding lands and a session
 * becomes something a user has invested typing into.
 *
 * Pure and clock-injected so the TTL, the reattach path, and the concurrency
 * cap are testable without timers.
 */

export type LedgerEntry = {
  nodeId: string;
  sessionId: string;
  webSocketDebuggerUrl: string;
  /** Number of live relay sockets attached to this Cloudflare session. */
  attached: number;
  /** When the last socket detached, or null while at least one is attached. */
  idleSince: number | null;
  createdAt: number;
};

export type ClaimResult =
  | { ok: true; entry: LedgerEntry; reused: boolean }
  | { ok: false; reason: "at_capacity" };

/**
 * Cloudflare's free plan allows three concurrent browsers. Two is the cap here
 * so an operator always has one session of headroom to open a browser by hand
 * while a demo is running.
 */
export const MAX_CONCURRENT_SESSIONS = 2;

/**
 * Grace period between the last socket detaching and the Cloudflare session
 * being closed. Long enough that a reload or a second tab reattaches to the
 * same page rather than paying for a fresh navigation.
 */
export const IDLE_GRACE_MS = 60_000;

export class SessionLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  constructor(
    private readonly maxConcurrent: number = MAX_CONCURRENT_SESSIONS,
    private readonly idleGraceMs: number = IDLE_GRACE_MS,
  ) {}

  size(): number {
    return this.entries.size;
  }

  get(nodeId: string): LedgerEntry | null {
    return this.entries.get(nodeId) ?? null;
  }

  /**
   * Reserves capacity for `nodeId`. An existing entry is reused (attach count
   * incremented) regardless of the cap, because reattaching costs Cloudflare
   * nothing new. A genuinely new session is refused once the cap is reached.
   */
  claim(nodeId: string, now: number): ClaimResult {
    const existing = this.entries.get(nodeId);
    if (existing) {
      existing.attached += 1;
      existing.idleSince = null;
      return { ok: true, entry: existing, reused: true };
    }
    if (this.entries.size >= this.maxConcurrent) {
      return { ok: false, reason: "at_capacity" };
    }
    const entry: LedgerEntry = {
      nodeId,
      sessionId: "",
      webSocketDebuggerUrl: "",
      attached: 1,
      idleSince: null,
      createdAt: now,
    };
    this.entries.set(nodeId, entry);
    return { ok: true, entry, reused: false };
  }

  /** Records the Cloudflare identifiers once the session actually exists. */
  bind(nodeId: string, sessionId: string, webSocketDebuggerUrl: string): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    entry.sessionId = sessionId;
    entry.webSocketDebuggerUrl = webSocketDebuggerUrl;
  }

  /** One relay socket went away. The Cloudflare session stays up for the grace period. */
  release(nodeId: string, now: number): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    entry.attached = Math.max(0, entry.attached - 1);
    if (entry.attached === 0) entry.idleSince = now;
  }

  /** Drops a reservation that never became a session, so it stops holding capacity. */
  abandon(nodeId: string): void {
    this.entries.delete(nodeId);
  }

  /**
   * Entries whose grace period has elapsed with nothing attached. Removed from
   * the ledger as they are returned, so the caller closes each exactly once.
   */
  reap(now: number): LedgerEntry[] {
    const expired: LedgerEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.attached === 0 && entry.idleSince !== null && now - entry.idleSince >= this.idleGraceMs) {
        expired.push(entry);
      }
    }
    for (const entry of expired) this.entries.delete(entry.nodeId);
    return expired;
  }

  /** Forcible close, used by the stop endpoint. Returns the entry to close upstream. */
  take(nodeId: string): LedgerEntry | null {
    const entry = this.entries.get(nodeId);
    if (!entry) return null;
    this.entries.delete(nodeId);
    return entry;
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
