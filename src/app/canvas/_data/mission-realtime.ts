"use client";

/**
 * Durable-delivery realtime subscriber for `mission_events`.
 *
 * Supabase Realtime's `postgres_changes` delivery is at-least-once and
 * unordered with respect to network retries, so this module is responsible
 * for turning that into the contract the rest of the canvas depends on:
 * committed events surfaced exactly once, in strict ascending sequence
 * order, with gaps closed by a catch-up fetch before anything is delivered.
 *
 * This module never decides *what a committed event means* for the mission
 * snapshot — that is `applyMissionEvent`'s job. It only decides *when it is
 * safe to say an event is next*.
 *
 * Deliberately decoupled from `@supabase/supabase-js`'s concrete classes:
 * `RealtimeClientLike`/`RealtimeChannelLike` below are the minimal structural
 * shape this module needs. A real `SupabaseClient` satisfies it (bridged
 * with an explicit cast at the call site in `live-mission-data-source.ts`,
 * see the comment there), and tests provide a small fake instead of a live
 * network.
 */

import type { MissionEvent, MissionEventType } from "@/core/contracts/types";
import type { MissionEventRow } from "@/core/database.types";

export type MissionRealtimeConnectionStatus =
  | "connecting"
  | "subscribed"
  | "reconnecting"
  | "disposed";

export interface RealtimeChannelLike {
  on(
    type: "postgres_changes",
    filter: { event: "INSERT"; schema: string; table: string; filter: string },
    callback: (payload: { new: Record<string, unknown> }) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string, error?: Error) => void): RealtimeChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): void;
}

export type MissionRealtimeOptions = {
  client: RealtimeClientLike;
  missionId: string;
  /** Sequence already reflected in local state; realtime resumes strictly after it. */
  startingSequence: number;
  /** Fetches committed events strictly after `afterSequence`, ascending. */
  fetchEventsSince: (afterSequence: number, signal?: AbortSignal) => Promise<MissionEvent[]>;
  /** Delivered exactly once per event id, in strict ascending sequence order. */
  onEvent: (event: MissionEvent) => void;
  /**
   * The buffer or a catch-up fetch could not reconcile a gap (fetch failed,
   * or the out-of-order buffer overflowed). The caller should refetch full
   * materialized state and, once it has a new baseline sequence, call
   * `resyncTo` to resume.
   */
  onUnrecoverableGap: (error: unknown) => void;
  /** Optional observability hook; never required for correctness. */
  onConnectionStatus?: (status: MissionRealtimeConnectionStatus) => void;
  /** Bounded out-of-order buffer size. Overflow triggers `onUnrecoverableGap`. */
  maxBufferedEvents?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** Injectable for deterministic tests. */
  scheduleTimer?: (run: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  randomImpl?: () => number;
};

const DEFAULT_MAX_BUFFERED_EVENTS = 50;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15_000;
const SEEN_ID_CAP = 500;

function defaultScheduleTimer(run: () => void, delayMs: number): unknown {
  return setTimeout(run, delayMs);
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

/** Maps a raw `mission_events` row (as delivered by postgres_changes) to a `MissionEvent`. */
export function mapMissionEventRow(row: MissionEventRow): MissionEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    nodeId: row.node_id ?? undefined,
    sequence: row.sequence,
    type: row.event_type as MissionEventType,
    actor: { kind: row.actor_kind as MissionEvent["actor"]["kind"], id: row.actor_id },
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    payload: row.payload as MissionEvent["payload"],
    trust: row.trust as MissionEvent["trust"],
    createdAt: row.created_at,
  };
}

/**
 * Subscribes to committed `mission_events` inserts for one mission and
 * delivers them in strict, gap-free, deduplicated sequence order.
 *
 * Lifecycle: construct, call `start()` once, call `dispose()` exactly once
 * when the mission is abandoned or the owner is torn down. Calling
 * `dispose()` more than once, or before `start()`, is safe and a no-op.
 */
export class MissionRealtimeSubscriber {
  private readonly options: Required<
    Pick<
      MissionRealtimeOptions,
      "maxBufferedEvents" | "reconnectBaseDelayMs" | "reconnectMaxDelayMs" | "randomImpl"
    >
  > &
    MissionRealtimeOptions;

  private channel: RealtimeChannelLike | null = null;
  private disposed = false;
  private lastCommittedSequence: number;
  private readonly buffer = new Map<number, MissionEvent>();
  private readonly seenIds = new Set<string>();
  private readonly seenIdOrder: string[] = [];
  private catchUpInFlight = false;
  private catchUpAbort: AbortController | null = null;
  private reconnectAttempt = 0;
  private reconnectHandle: unknown = null;

  constructor(options: MissionRealtimeOptions) {
    this.options = {
      maxBufferedEvents: options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
      reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
      randomImpl: options.randomImpl ?? Math.random,
      ...options,
    };
    this.lastCommittedSequence = options.startingSequence;
  }

  private get scheduleTimer() {
    return this.options.scheduleTimer ?? defaultScheduleTimer;
  }

  private get clearTimer() {
    return this.options.clearTimer ?? defaultClearTimer;
  }

  private reportStatus(status: MissionRealtimeConnectionStatus) {
    this.options.onConnectionStatus?.(status);
  }

  private markSeen(id: string): boolean {
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    this.seenIdOrder.push(id);
    if (this.seenIdOrder.length > SEEN_ID_CAP) {
      const evicted = this.seenIdOrder.shift();
      if (evicted !== undefined) this.seenIds.delete(evicted);
    }
    return true;
  }

  private deliver(event: MissionEvent): void {
    if (!this.markSeen(event.id)) return;
    this.lastCommittedSequence = event.sequence;
    this.options.onEvent(event);
  }

  private drainBuffer(): void {
    while (this.buffer.has(this.lastCommittedSequence + 1)) {
      const next = this.buffer.get(this.lastCommittedSequence + 1);
      this.buffer.delete(this.lastCommittedSequence + 1);
      if (next) this.deliver(next);
    }
  }

  private handleIncoming(event: MissionEvent): void {
    if (this.disposed) return;
    if (this.seenIds.has(event.id)) return;
    if (event.sequence <= this.lastCommittedSequence) {
      // Stale at-least-once redelivery of an already-committed sequence.
      this.markSeen(event.id);
      return;
    }
    if (event.sequence === this.lastCommittedSequence + 1) {
      this.deliver(event);
      this.drainBuffer();
      return;
    }

    // Out-of-order arrival: buffer it and close the gap with a catch-up fetch.
    if (!this.buffer.has(event.sequence) && this.buffer.size >= this.options.maxBufferedEvents) {
      this.buffer.clear();
      this.options.onUnrecoverableGap(
        new Error(
          `Out-of-order buffer overflow past ${this.options.maxBufferedEvents} pending events`,
        ),
      );
      return;
    }
    this.buffer.set(event.sequence, event);
    void this.runCatchUp();
  }

  private async runCatchUp(): Promise<void> {
    if (this.catchUpInFlight || this.disposed) return;
    this.catchUpInFlight = true;
    const abort = new AbortController();
    this.catchUpAbort = abort;
    const resumeFrom = this.lastCommittedSequence;
    try {
      const events = await this.options.fetchEventsSince(resumeFrom, abort.signal);
      this.catchUpInFlight = false;
      this.catchUpAbort = null;
      if (this.disposed) return;
      for (const event of events) {
        if (event.sequence <= this.lastCommittedSequence) continue;
        this.buffer.set(event.sequence, event);
      }
      this.drainBuffer();
      if (this.buffer.size > 0 && !this.buffer.has(this.lastCommittedSequence + 1)) {
        // The authoritative catch-up fetch is contiguous from the server; a
        // hole that survives it is not something this module can explain.
        this.buffer.clear();
        this.options.onUnrecoverableGap(
          new Error("Catch-up fetch left an unexplained sequence gap"),
        );
      }
    } catch (error) {
      this.catchUpInFlight = false;
      this.catchUpAbort = null;
      if (!this.disposed) this.options.onUnrecoverableGap(error);
    }
  }

  private backoffDelayMs(): number {
    const { reconnectBaseDelayMs, reconnectMaxDelayMs, randomImpl } = this.options;
    const exponential = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** this.reconnectAttempt);
    const jitterFactor = 0.5 + randomImpl() * 0.5;
    return Math.min(reconnectMaxDelayMs, Math.round(exponential * jitterFactor));
  }

  private teardownChannel(): void {
    if (this.channel) {
      try {
        this.options.client.removeChannel(this.channel);
      } catch {
        // Best-effort; the channel may already be gone.
      }
      this.channel = null;
    }
  }

  private openChannel(): void {
    const filter = `mission_id=eq.${this.options.missionId}`;
    const channel = this.options.client.channel(`mission-events:${this.options.missionId}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "mission_events", filter },
      (payload) => {
        try {
          this.handleIncoming(mapMissionEventRow(payload.new as unknown as MissionEventRow));
        } catch (error) {
          this.options.onUnrecoverableGap(error);
        }
      },
    );
    channel.subscribe((status) => this.handleStatus(status));
    this.channel = channel;
  }

  private handleStatus(status: string): void {
    if (this.disposed) return;
    if (status === "SUBSCRIBED") {
      this.reconnectAttempt = 0;
      this.reportStatus("subscribed");
      // Backfill anything committed while (re)connecting before trusting the stream.
      void this.runCatchUp();
      return;
    }
    if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectHandle !== null) return;
    this.reportStatus("reconnecting");
    const delay = this.backoffDelayMs();
    this.reconnectAttempt += 1;
    this.reconnectHandle = this.scheduleTimer(() => {
      this.reconnectHandle = null;
      if (this.disposed) return;
      this.teardownChannel();
      this.openChannel();
    }, delay);
  }

  /** Begins the subscription. Call exactly once. */
  start(): void {
    if (this.disposed || this.channel) return;
    this.reportStatus("connecting");
    this.openChannel();
  }

  /**
   * Resumes delivery from a fresh baseline after the caller has refetched
   * full materialized state (e.g. after `onUnrecoverableGap`). Clears the
   * buffer and dedupe state so events already folded into the new snapshot
   * are not redelivered.
   */
  resyncTo(sequence: number): void {
    this.lastCommittedSequence = sequence;
    this.buffer.clear();
  }

  /** Tears down the subscription. Safe to call multiple times. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.catchUpAbort?.abort();
    if (this.reconnectHandle !== null) {
      this.clearTimer(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    this.teardownChannel();
    this.buffer.clear();
    this.reportStatus("disposed");
  }
}
