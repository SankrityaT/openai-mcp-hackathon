import assert from "node:assert/strict";
import test from "node:test";
import {
  MissionRealtimeSubscriber,
  type RealtimeChannelLike,
  type RealtimeClientLike,
} from "./mission-realtime";
import type { MissionEvent } from "@/core/contracts/types";

/** A fake channel/client pair: no live network, full control over delivery timing. */
class FakeChannel implements RealtimeChannelLike {
  insertCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;
  statusCallback: ((status: string, error?: Error) => void) | null = null;
  subscribed = false;

  on(
    _type: "postgres_changes",
    _filter: { event: "INSERT"; schema: string; table: string; filter: string },
    callback: (payload: { new: Record<string, unknown> }) => void,
  ): RealtimeChannelLike {
    this.insertCallback = callback;
    return this;
  }

  subscribe(callback?: (status: string, error?: Error) => void): RealtimeChannelLike {
    this.statusCallback = callback ?? null;
    this.subscribed = true;
    return this;
  }

  /** Test helper: simulate a postgres_changes INSERT delivery. */
  emitInsert(row: Record<string, unknown>): void {
    this.insertCallback?.({ new: row });
  }

  /** Test helper: simulate a channel status transition. */
  emitStatus(status: string): void {
    this.statusCallback?.(status);
  }
}

class FakeClient implements RealtimeClientLike {
  channels: FakeChannel[] = [];
  channelNames: string[] = [];
  removed: RealtimeChannelLike[] = [];

  channel(name: string): RealtimeChannelLike {
    this.channelNames.push(name);
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }

  removeChannel(channel: RealtimeChannelLike): void {
    this.removed.push(channel);
  }

  get latest(): FakeChannel {
    const channel = this.channels[this.channels.length - 1];
    if (!channel) throw new Error("No channel created yet");
    return channel;
  }
}

function row(overrides: Partial<Record<string, unknown>> & { sequence: number }): Record<string, unknown> {
  return {
    id: `event-${overrides.sequence}`,
    tenant_id: "tenant-1",
    mission_id: "mission-1",
    node_id: null,
    event_type: "node.started",
    actor_kind: "system",
    actor_id: "system",
    correlation_id: "corr-1",
    causation_id: null,
    idempotency_key: null,
    payload: {},
    trust: "trusted",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function noopFetch(): Promise<MissionEvent[]> {
  return Promise.resolve([]);
}

test("delivers an in-order event immediately and advances the resume point", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
  });
  subscriber.start();
  client.latest.emitInsert(row({ sequence: 1 }));

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].sequence, 1);
  subscriber.dispose();
});

test("dedupes an event delivered twice by id", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
  });
  subscriber.start();
  const duplicate = row({ sequence: 1 });
  client.latest.emitInsert(duplicate);
  client.latest.emitInsert(duplicate);

  assert.equal(delivered.length, 1);
  subscriber.dispose();
});

test("ignores a stale redelivery of an already-committed sequence", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
  });
  subscriber.start();
  client.latest.emitInsert(row({ sequence: 1 }));
  // Redelivered with a different id but the same already-committed sequence.
  client.latest.emitInsert(row({ sequence: 1, id: "event-1-retry" }));

  assert.equal(delivered.length, 1);
  subscriber.dispose();
});

test("buffers an out-of-order event and delivers in strict order once the gap fills", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
  });
  subscriber.start();
  client.latest.emitInsert(row({ sequence: 2 }));
  assert.equal(delivered.length, 0, "sequence 2 must wait for sequence 1");

  client.latest.emitInsert(row({ sequence: 1 }));
  assert.deepEqual(
    delivered.map((e) => e.sequence),
    [1, 2],
  );
  subscriber.dispose();
});

test("a gap triggers a catch-up fetch that backfills and delivers in order", async () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const fetchCalls: number[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: async (after) => {
      fetchCalls.push(after);
      const events: MissionEvent[] = [];
      for (let sequence = after + 1; sequence <= 5; sequence += 1) {
        events.push({
          id: `event-${sequence}`,
          tenantId: "tenant-1",
          missionId: "mission-1",
          sequence,
          type: "node.started",
          actor: { kind: "system", id: "system" },
          correlationId: "corr-1",
          payload: {},
          trust: "trusted",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      return events;
    },
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("catch-up should close the gap"),
  });
  subscriber.start();
  client.latest.emitInsert(row({ sequence: 5 }));

  // The catch-up fetch runs asynchronously; give it a tick to resolve.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fetchCalls, [0]);
  assert.deepEqual(
    delivered.map((e) => e.sequence),
    [1, 2, 3, 4, 5],
  );
  subscriber.dispose();
});

test("buffer overflow reports an unrecoverable gap instead of growing without bound", () => {
  const client = new FakeClient();
  let gapError: unknown = null;
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    maxBufferedEvents: 3,
    // Never resolves during this test, so the buffer cannot drain via catch-up.
    fetchEventsSince: () => new Promise(() => {}),
    onEvent: () => assert.fail("nothing should be delivered before the gap closes"),
    onUnrecoverableGap: (error) => {
      gapError = error;
    },
  });
  subscriber.start();
  client.latest.emitInsert(row({ sequence: 10 }));
  client.latest.emitInsert(row({ sequence: 11 }));
  client.latest.emitInsert(row({ sequence: 12 }));
  client.latest.emitInsert(row({ sequence: 13 }));

  assert.ok(gapError, "expected an unrecoverable gap to be reported");
  subscriber.dispose();
});

test("reconnects with bounded backoff and resumes catch-up from the last committed sequence", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const fetchCalls: number[] = [];
  const scheduled: Array<{ run: () => void; delayMs: number }> = [];
  const statuses: string[] = [];

  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 3,
    fetchEventsSince: async (after) => {
      fetchCalls.push(after);
      return [];
    },
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
    onConnectionStatus: (status) => statuses.push(status),
    scheduleTimer: (run, delayMs) => {
      scheduled.push({ run, delayMs });
      return scheduled.length;
    },
    clearTimer: () => {},
    randomImpl: () => 0,
  });
  subscriber.start();
  assert.equal(statuses.at(-1), "connecting");

  const firstChannel = client.latest;
  firstChannel.emitStatus("CHANNEL_ERROR");
  assert.equal(statuses.at(-1), "reconnecting");
  assert.equal(scheduled.length, 1);
  const firstDelay = scheduled[0].delayMs;
  assert.ok(firstDelay > 0);

  // Fire the scheduled reconnect: a new channel is opened and resubscribed.
  scheduled[0].run();
  assert.equal(client.removed.length, 1, "the errored channel should be torn down");
  assert.equal(client.channels.length, 2, "a fresh channel should be opened");

  // A second failure should back off further (bounded, but not shrinking).
  client.latest.emitStatus("CHANNEL_ERROR");
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled[1].delayMs >= firstDelay);

  scheduled[1].run();
  client.latest.emitStatus("SUBSCRIBED");
  assert.equal(statuses.at(-1), "subscribed");
  // Resuming must fetch strictly after the last committed sequence (3), not from 0.
  assert.deepEqual(fetchCalls, [3]);
  assert.equal(delivered.length, 0);

  subscriber.dispose();
});

test("resyncTo clears the buffer and moves the resume point forward", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => {},
  });
  subscriber.start();
  // Buffer a far-future event; it must not be replayed after the resync jumps past it.
  client.latest.emitInsert(row({ sequence: 50 }));

  subscriber.resyncTo(100);
  client.latest.emitInsert(row({ sequence: 101, id: "event-101" }));

  assert.deepEqual(
    delivered.map((e) => e.sequence),
    [101],
  );
  subscriber.dispose();
});

test("dispose is idempotent and stops further delivery", () => {
  const client = new FakeClient();
  const delivered: MissionEvent[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => {},
  });
  subscriber.start();
  subscriber.dispose();
  subscriber.dispose();
  client.latest.emitInsert(row({ sequence: 1 }));

  assert.equal(delivered.length, 0);
  assert.equal(client.removed.length, 1);
});

/** Deterministic stand-in for the polling timer pair. */
function fakePollTimers() {
  const scheduled: Array<{ id: number; run: () => void; delayMs: number }> = [];
  let nextId = 1;
  return {
    scheduled,
    schedulePollTimer: (run: () => void, delayMs: number) => {
      const entry = { id: nextId, run, delayMs };
      nextId += 1;
      scheduled.push(entry);
      return entry.id;
    },
    clearPollTimer: (handle: unknown) => {
      const index = scheduled.findIndex((entry) => entry.id === handle);
      if (index >= 0) scheduled.splice(index, 1);
    },
    /** Fires the most recently scheduled pending timer. */
    fireLatest: () => {
      const entry = scheduled.pop();
      if (!entry) throw new Error("No polling timer scheduled");
      entry.run();
    },
  };
}

function committed(sequence: number): MissionEvent {
  return {
    id: `event-${sequence}`,
    tenantId: "tenant-1",
    missionId: "mission-1",
    sequence,
    type: "node.started",
    actor: { kind: "system", id: "system" },
    correlationId: "corr-1",
    payload: {},
    trust: "trusted",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("polling engages when the channel never reaches joined", async () => {
  const client = new FakeClient();
  const timers = fakePollTimers();
  const delivered: MissionEvent[] = [];
  const fetchCalls: number[] = [];
  const statuses: string[] = [];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: async (after) => {
      fetchCalls.push(after);
      return [committed(1), committed(2)];
    },
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("polling should not report a gap"),
    onConnectionStatus: (status) => statuses.push(status),
    pollActivationDelayMs: 4_000,
    schedulePollTimer: timers.schedulePollTimer,
    clearPollTimer: timers.clearPollTimer,
  });
  subscriber.start();

  // The activation watchdog is armed, but nothing is polled until it expires.
  assert.equal(timers.scheduled.length, 1);
  assert.equal(timers.scheduled[0].delayMs, 4_000);
  assert.deepEqual(fetchCalls, []);

  // The channel is still silent after the grace period.
  timers.fireLatest();
  assert.equal(statuses.at(-1), "polling");
  assert.equal(timers.scheduled.length, 1, "a first polling tick should be queued");

  timers.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fetchCalls, [0]);
  assert.deepEqual(
    delivered.map((event) => event.sequence),
    [1, 2],
  );

  subscriber.dispose();
});

test("polling does not engage once the channel joins", () => {
  const client = new FakeClient();
  const timers = fakePollTimers();
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: noopFetch,
    onEvent: () => {},
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
    schedulePollTimer: timers.schedulePollTimer,
    clearPollTimer: timers.clearPollTimer,
  });
  subscriber.start();
  client.latest.emitStatus("SUBSCRIBED");

  assert.equal(timers.scheduled.length, 0, "a joined channel disarms the watchdog");
  subscriber.dispose();
});

test("polling cadence follows the activity hint and stops on a terminal mission", async () => {
  const client = new FakeClient();
  const timers = fakePollTimers();
  let hint = { hot: true, terminal: false };
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: async () => [],
    onEvent: () => {},
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
    activityHint: () => hint,
    pollActivationDelayMs: 4_000,
    pollHotIntervalMs: 2_500,
    pollIdleIntervalMs: 10_000,
    schedulePollTimer: timers.schedulePollTimer,
    clearPollTimer: timers.clearPollTimer,
  });
  subscriber.start();
  timers.fireLatest();

  assert.equal(timers.scheduled[0].delayMs, 2_500, "hot activity polls fast");

  hint = { hot: false, terminal: false };
  timers.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.scheduled[0].delayMs, 10_000, "idle activity backs off");

  hint = { hot: false, terminal: true };
  timers.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.scheduled.length, 0, "a terminal mission stops polling");

  subscriber.dispose();
});

test("polling and a late realtime message still deliver exactly once, in order", async () => {
  const client = new FakeClient();
  const timers = fakePollTimers();
  const delivered: MissionEvent[] = [];
  let available = [committed(1), committed(2)];
  const subscriber = new MissionRealtimeSubscriber({
    client,
    missionId: "mission-1",
    startingSequence: 0,
    fetchEventsSince: async (after) => available.filter((event) => event.sequence > after),
    onEvent: (event) => delivered.push(event),
    onUnrecoverableGap: () => assert.fail("should not need a gap resync"),
    activityHint: () => ({ hot: true, terminal: false }),
    schedulePollTimer: timers.schedulePollTimer,
    clearPollTimer: timers.clearPollTimer,
  });
  subscriber.start();
  timers.fireLatest();
  timers.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    delivered.map((event) => event.sequence),
    [1, 2],
  );

  // The channel wakes up and redelivers what polling already committed, then
  // carries the next event itself.
  client.latest.emitStatus("SUBSCRIBED");
  client.latest.emitInsert(row({ sequence: 2 }));
  available = [...available, committed(3)];
  client.latest.emitInsert(row({ sequence: 3 }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    delivered.map((event) => event.sequence),
    [1, 2, 3],
    "no duplicate and no reordering across the two sources",
  );
  assert.equal(new Set(delivered.map((event) => event.id)).size, delivered.length);

  subscriber.dispose();
});
