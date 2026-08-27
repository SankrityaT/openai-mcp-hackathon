import assert from "node:assert/strict";
import test from "node:test";
import { BudgetTracker, backoffDelayMs } from "./budget";

test("enforces maxModelCalls before the limit is reached and reports the limit kind", () => {
  const tracker = new BudgetTracker({ maxModelCalls: 2 });
  assert.equal(tracker.checkModelCall().ok, true);
  tracker.recordModelCall();
  assert.equal(tracker.checkModelCall().ok, true);
  tracker.recordModelCall();
  const result = tracker.checkModelCall();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "max_model_calls");
    assert.equal(result.used, 2);
    assert.equal(result.limit, 2);
  }
});

test("enforces maxWallClockMs against an injectable clock", () => {
  let now = 1_000;
  const tracker = new BudgetTracker({ maxWallClockMs: 500 }, () => now);
  assert.equal(tracker.checkDuration().ok, true);
  now = 1_600; // 600ms elapsed > 500ms budget
  const result = tracker.checkDuration();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "max_duration");
});

test("maxRetries tolerates N retries beyond the first attempt, not N total failures", () => {
  const tracker = new BudgetTracker({ maxRetries: 1 });
  assert.equal(tracker.checkRetry().ok, true);
  tracker.recordRetry(); // first failure recorded
  assert.equal(tracker.checkRetry().ok, true, "one retry beyond the first attempt is still allowed");
  tracker.recordRetry(); // second failure recorded
  const result = tracker.checkRetry();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "max_retries");
});

test("enforces maxToolCalls independently of model-call budget", () => {
  const tracker = new BudgetTracker({ maxToolCalls: 1 });
  assert.equal(tracker.checkToolCall().ok, true);
  tracker.recordToolCall();
  const result = tracker.checkToolCall();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "max_tool_calls");
});

test("an unset limit never exhausts", () => {
  const tracker = new BudgetTracker({});
  assert.equal(tracker.checkModelCall().ok, true);
  assert.equal(tracker.checkToolCall().ok, true);
  assert.equal(tracker.checkRetry().ok, true);
  assert.equal(tracker.checkDuration().ok, true);
});

test("backoffDelayMs is bounded and non-negative across increasing attempts", () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const delay = backoffDelayMs(attempt, 100, 2_000);
    assert.ok(delay >= 0);
    assert.ok(delay <= 2_000);
  }
});
