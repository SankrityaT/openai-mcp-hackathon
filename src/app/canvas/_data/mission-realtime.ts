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
 *
 * Realtime is not always available. Guest and judge sessions talk to Supabase
 * with the anon key, which cannot satisfy the `mission_events` row-level
 * security policy, so `postgres_changes` delivers nothing to them even though
 * the channel itself may look healthy. This subscriber therefore also runs a
 * polling mode over the same catch-up fetch it already owns, so ordering,
 * dedupe, and gap handling stay single-coded no matter which source produced
 * the event.
 */

import type { MissionEvent, MissionEventType } from "@/core/contracts/types";
import type { MissionEventRow } from "@/core/database.types";

export type MissionRealtimeConnectionStatus =
  | "connecting"
  | "subscribed"
  | "reconnecting"
  /** The channel never joined (or errored); progress now comes from polling. */
  | "polling"
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

/**
 * What the owner of the subscription knows about the mission right now, used
 * only to pick a polling cadence. Supplied by `LiveMissionDataSource`, which
 * holds the committed snapshot; this module deliberately does not interpret
 * mission state itself.
 */
export type MissionActivityHint = {
  /** Work is moving: any node running or awaiting approval, or planning is pending. */
  hot: boolean;
  /** The mission reached a terminal stage; polling stops for good. */
  terminal: boolean;
};

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
  /**
   * Read before every polling tick to choose a cadence. Omitted means the
   * owner has nothing to say, which is treated as a cold, non-terminal
   * mission.
   */
  activityHint?: () => MissionActivityHint;
  /** How long the channel may take to join before polling engages. */
  pollActivationDelayMs?: number;
  pollHotIntervalMs?: number;
  pollIdleIntervalMs?: number;
  /**
   * Polling has its own injectable timer pair so a test can drive reconnect
   * backoff and polling cadence independently.
   */
  schedulePollTimer?: (run: () => void, delayMs: number) => unknown;
  clearPollTimer?: (handle: unknown) => void;
};

const DEFAULT_MAX_BUFFERED_EVENTS = 50;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15_000;
const SEEN_ID_CAP = 500;
const DEFAULT_POLL_ACTIVATION_DELAY_MS = 4_000;
const DEFAULT_POLL_HOT_INTERVAL_MS = 2_500;
const DEFAULT_POLL_IDLE_INTERVAL_MS = 10_000;
const COLD_ACTIVITY_HINT: MissionActivityHint = { hot: false, terminal: false };

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
  private joined = false;
  private pollingEngaged = false;
  private channelDelivered = false;
  private pollingRetired = false;
  private pollHandle: unknown = null;
  private pollActivationHandle: unknown = null;

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

  private get schedulePollTimer() {
    return this.options.schedulePollTimer ?? defaultScheduleTimer;
  }

  private get clearPollTimer() {
    return this.options.clearPollTimer ?? defaultClearTimer;
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

  private readActivityHint(): MissionActivityHint {
    const hint = this.options.activityHint;
    if (!hint) return COLD_ACTIVITY_HINT;
    try {
      return hint();
    } catch {
      // The hint is an optimization, never a correctness input.
      return COLD_ACTIVITY_HINT;
    }
  }

  private clearPollActivation(): void {
    if (this.pollActivationHandle === null) return;
    this.clearPollTimer(this.pollActivationHandle);
    this.pollActivationHandle = null;
  }

  /**
   * Arms the watchdog that engages polling unless the channel has actually
   * DELIVERED a row in time. Joining is not evidence: guest and judge
   * sessions join successfully and then receive nothing, because row-level
   * security filters every row out of a channel the anon key opened. Only a
   * delivered event proves the stream carries this mission.
   */
  private armPollActivation(): void {
    if (this.disposed || this.pollingEngaged || this.pollingRetired) return;
    if (this.pollActivationHandle !== null) return;
    const delay = this.options.pollActivationDelayMs ?? DEFAULT_POLL_ACTIVATION_DELAY_MS;
    this.pollActivationHandle = this.schedulePollTimer(() => {
      this.pollActivationHandle = null;
      if (this.disposed || this.channelDelivered) return;
      this.engagePolling();
    }, delay);
  }

  /**
   * Switches on the polling fallback. Once engaged it stays engaged for the
   * life of the subscription: a channel that later joins may still be silent
   * (row-level security), and duplicate arrivals are already free thanks to
   * the id/sequence dedupe every delivery goes through.
   */
  private engagePolling(): void {
    if (this.disposed || this.pollingEngaged || this.pollingRetired) return;
    this.pollingEngaged = true;
    this.clearPollActivation();
    this.reportStatus("polling");
    this.scheduleNextPoll();
  }

  private scheduleNextPoll(): void {
    if (this.disposed || !this.pollingEngaged || this.pollHandle !== null) return;
    const hint = this.readActivityHint();
    if (hint.terminal) {
      // Nothing further can be committed; stop asking.
      this.pollingEngaged = false;
      this.pollingRetired = true;
      return;
    }
    const interval = hint.hot
      ? (this.options.pollHotIntervalMs ?? DEFAULT_POLL_HOT_INTERVAL_MS)
      : (this.options.pollIdleIntervalMs ?? DEFAULT_POLL_IDLE_INTERVAL_MS);
    this.pollHandle = this.schedulePollTimer(() => {
      this.pollHandle = null;
      if (this.disposed || !this.pollingEngaged) return;
      // Deliberately the same catch-up path realtime gaps use, so ordering,
      // dedupe, and gap reporting have exactly one implementation.
      void this.runCatchUp().then(
        () => this.scheduleNextPoll(),
        () => this.scheduleNextPoll(),
      );
    }, interval);
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
          this.channelDelivered = true;
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
      this.joined = true;
      // The watchdog stays armed: a joined channel that has delivered
      // nothing is indistinguishable from an RLS-silent one.
      this.reportStatus("subscribed");
      // Backfill anything committed while (re)connecting before trusting the stream.
      void this.runCatchUp();
      return;
    }
    if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.joined = false;
      // A channel that errors is not going to carry progress on its own.
      this.engagePolling();
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
    this.armPollActivation();
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
    this.clearPollActivation();
    if (this.pollHandle !== null) {
      this.clearPollTimer(this.pollHandle);
      this.pollHandle = null;
    }
    this.pollingEngaged = false;
    this.teardownChannel();
    this.buffer.clear();
    this.reportStatus("disposed");
  }
}
