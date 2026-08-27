import assert from "node:assert/strict";
import test from "node:test";
import {
  configureObservability,
  getCorrelationId,
  resetObservability,
  runWithCorrelationId,
  withSpan,
  type EmittedSpan,
} from "./tracer";

function capture(): EmittedSpan[] {
  const spans: EmittedSpan[] = [];
  let tick = 0;
  configureObservability({
    emit: (span) => spans.push(span),
    clock: { monotonic: () => (tick += 5), wall: () => 1_700_000_000_000 },
  });
  return spans;
}

test("emits a redacted ok span with attributes and a positive duration", async () => {
  resetObservability();
  const spans = capture();

  const result = await withSpan("harness.model.call", { modelId: "gpt-5.6-terra" }, (span) => {
    span.set({ inputTokens: 10, outputTokens: 5, authToken: "sk-live-secret0123456789" });
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.name, "harness.model.call");
  assert.equal(span.status, "ok");
  assert.ok(span.durationMs > 0);
  assert.equal(span.attributes.modelId, "gpt-5.6-terra");
  assert.equal(span.attributes.inputTokens, 10);
  // Unknown key dropped even though set() accepted it.
  assert.equal("authToken" in span.attributes, false);
  resetObservability();
});

test("captures errors as an error span (class name only) and rethrows", async () => {
  resetObservability();
  const spans = capture();

  class ModelNotConfiguredError extends Error {
    constructor() {
      super("OPENAI_API_KEY leaked-secret-should-not-appear");
      this.name = "ModelNotConfiguredError";
    }
  }

  await assert.rejects(
    () => withSpan("harness.model.call", {}, () => Promise.reject(new ModelNotConfiguredError())),
    (error: unknown) => error instanceof ModelNotConfiguredError,
  );

  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.status, "error");
  assert.equal(span.errorType, "ModelNotConfiguredError");
  // The error *message* must never ride along.
  assert.ok(!JSON.stringify(span).includes("leaked-secret-should-not-appear"));
  resetObservability();
});

test("threads correlationId into nested spans and links parent/child", async () => {
  resetObservability();
  const spans = capture();

  await runWithCorrelationId("corr-123", async () => {
    assert.equal(getCorrelationId(), "corr-123");
    await withSpan("outer", {}, async () => {
      await withSpan("inner", {}, () => undefined);
    });
  });

  const outer = spans.find((s) => s.name === "outer")!;
  const inner = spans.find((s) => s.name === "inner")!;
  assert.equal(outer.correlationId, "corr-123");
  assert.equal(inner.correlationId, "corr-123");
  assert.equal(inner.parentSpanId, outer.spanId);
  assert.equal(outer.parentSpanId, null);
  resetObservability();
});

test("explicit correlationId option overrides ambient context", async () => {
  resetObservability();
  const spans = capture();

  await withSpan("registry.execute", {}, () => undefined, { correlationId: "explicit-9" });

  assert.equal(spans[0]!.correlationId, "explicit-9");
  resetObservability();
});

test("a throwing emitter never breaks the mission path", async () => {
  resetObservability();
  configureObservability({
    emit: () => {
      throw new Error("emitter exploded");
    },
    clock: { monotonic: () => 1, wall: () => 1 },
  });

  // Success path: fn result returned despite emit throwing.
  const value = await withSpan("s", {}, () => "ok-value");
  assert.equal(value, "ok-value");

  // Failure path: fn's own error propagates, emit failure swallowed.
  await assert.rejects(
    () => withSpan("s", {}, () => Promise.reject(new Error("real-failure"))),
    /real-failure/,
  );
  resetObservability();
});
