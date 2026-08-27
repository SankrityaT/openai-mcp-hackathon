// Zero-dependency structured span emitter.
//
// Why not real OpenTelemetry? `@opentelemetry/api` is not resolvable in this
// tree (it is not an installed or transitively-hoisted dependency), and the
// ticket forbids adding one. This module therefore emits its own redacted,
// structured span records — one JSON line per span to stdout — which a Vercel
// log drain (or any log collector) can ingest and reconstruct into traces via
// the shared `correlationId` + `parentSpanId` links. Wiring a real OTLP
// exporter later is a localized change to `emit` below (see the handoff notes),
// gated on dependency approval.
//
// Invariants this module guarantees:
//   * A span emit can NEVER throw into the mission path. Every internal step is
//     defensively wrapped; only the wrapped `fn`'s own error propagates.
//   * All timing goes through an injectable clock. `Date.now()` may be
//     restricted in some execution contexts, so durations use a monotonic
//     source (`performance.now`) and the wall timestamp is best-effort.
//   * Attributes are redacted (allowlist + value scrubbing) immediately before
//     export — see ./redact.
//   * `correlationId` threads through nested spans via AsyncLocalStorage, so a
//     child span (e.g. a model call inside an Inngest step) inherits the parent
//     correlation without any explicit plumbing.

import { AsyncLocalStorage } from "node:async_hooks";
import { redactAttributes, type SpanAttributeValue, type SpanAttributes } from "./redact";

export type SpanStatus = "ok" | "error";

/** Mutable handle passed to a span body so it can attach attributes discovered
 *  during execution (e.g. token counts known only after the model returns). */
export interface SpanHandle {
  set(attributes: SpanAttributes): void;
}

export interface EmittedSpan {
  name: string;
  spanId: string;
  parentSpanId: string | null;
  correlationId: string | null;
  status: SpanStatus;
  /** Best-effort epoch milliseconds; 0 if the wall clock is unavailable. */
  startedAtMs: number;
  /** Monotonic elapsed milliseconds. */
  durationMs: number;
  attributes: Record<string, SpanAttributeValue>;
  /** Error *class name* only on failure — never the message (may carry PII). */
  errorType?: string;
}

export interface ObservabilityClock {
  /** Monotonic milliseconds, used for durations. */
  monotonic(): number;
  /** Epoch milliseconds, best-effort; used only for the start timestamp. */
  wall(): number;
}

export type SpanEmitter = (span: EmittedSpan) => void;

interface TraceContext {
  correlationId: string | null;
  spanId: string | null;
}

const storage = new AsyncLocalStorage<TraceContext>();

function defaultClock(): ObservabilityClock {
  return {
    monotonic: () => {
      try {
        return performance.now();
      } catch {
        return 0;
      }
    },
    wall: () => {
      try {
        return Date.now();
      } catch {
        return 0;
      }
    },
  };
}

function defaultEmit(span: EmittedSpan): void {
  // Explicit opt-out only; enabled by default so production traces exist
  // without extra configuration.
  if (process.env.CARDEA_TRACING_ENABLED === "false") return;
  try {
    // One structured line per span for log-drain ingestion.
    console.log(JSON.stringify({ observability: "span", ...span }));
  } catch {
    /* never throw into the mission path */
  }
}

let clock: ObservabilityClock = defaultClock();
let emit: SpanEmitter = defaultEmit;
let spanCounter = 0;

function nextSpanId(): string {
  try {
    spanCounter = (spanCounter + 1) >>> 0;
    const rand = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    return `${spanCounter.toString(16).padStart(8, "0")}${rand}`;
  } catch {
    return "0";
  }
}

function errorTypeOf(error: unknown): string {
  try {
    if (error && typeof error === "object") {
      const name = (error as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) return name.slice(0, 80);
    }
  } catch {
    /* fall through */
  }
  return "Error";
}

/**
 * Run `fn` as a traced span. The span inherits the active correlation id (and
 * parent span id) from any enclosing `withSpan` / `runWithCorrelationId`, or
 * from an explicit `options.correlationId`. Attributes passed here plus any set
 * via the `SpanHandle` are redacted before emit.
 *
 * Emitting the span never throws; only `fn`'s own rejection/throw propagates.
 */
export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: SpanHandle) => T | Promise<T>,
  options?: { correlationId?: string | null },
): Promise<T> {
  const parent = storage.getStore() ?? null;
  const correlationId = options?.correlationId ?? parent?.correlationId ?? null;
  const parentSpanId = parent?.spanId ?? null;
  const spanId = nextSpanId();

  const collected: SpanAttributes = { ...attributes };
  const handle: SpanHandle = {
    set(next) {
      try {
        Object.assign(collected, next);
      } catch {
        /* ignore malformed attribute updates */
      }
    },
  };

  let start = 0;
  let startedAtMs = 0;
  try {
    start = clock.monotonic();
    startedAtMs = clock.wall();
  } catch {
    /* keep defaults */
  }

  const finish = (status: SpanStatus, errorType?: string) => {
    try {
      let durationMs = 0;
      try {
        durationMs = Math.max(0, clock.monotonic() - start);
      } catch {
        durationMs = 0;
      }
      const span: EmittedSpan = {
        name,
        spanId,
        parentSpanId,
        correlationId,
        status,
        startedAtMs,
        durationMs,
        attributes: redactAttributes(collected),
        ...(errorType ? { errorType } : {}),
      };
      emit(span);
    } catch {
      /* a failing span emit must never break the mission path */
    }
  };

  const context: TraceContext = { correlationId, spanId };
  try {
    const result = await storage.run(context, async () => fn(handle));
    finish("ok");
    return result;
  } catch (error) {
    finish("error", errorTypeOf(error));
    throw error;
  }
}

/** Establish the active correlation id for everything (spans and nested spans)
 *  run inside `fn`. Returns whatever `fn` returns (including a promise). */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  const parent = storage.getStore() ?? null;
  return storage.run({ correlationId, spanId: parent?.spanId ?? null }, fn);
}

/** The correlation id currently in scope, if any. */
export function getCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

/** Test seam: swap the clock and/or emitter. */
export function configureObservability(config: {
  clock?: Partial<ObservabilityClock>;
  emit?: SpanEmitter;
}): void {
  if (config.emit) emit = config.emit;
  if (config.clock) clock = { ...clock, ...config.clock };
}

/** Test seam: restore defaults and reset the span counter. */
export function resetObservability(): void {
  clock = defaultClock();
  emit = defaultEmit;
  spanCounter = 0;
}
