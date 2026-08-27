import type { BudgetLimits } from "@/core/contracts/types";

export type BudgetLimitKind = "max_model_calls" | "max_tool_calls" | "max_retries" | "max_duration";

export type BudgetCheckResult = { ok: true } | { ok: false; kind: BudgetLimitKind; used: number; limit: number };

/**
 * Tracks a single node execution's consumption against `BudgetLimits` and
 * decides when to stop. Every limit degrades to a bounded, visible stop —
 * never an unbounded loop. Wall-clock is measured against an injectable
 * clock so tests can simulate elapsed time deterministically.
 */
export class BudgetTracker {
  private modelCalls = 0;
  private toolCalls = 0;
  private retries = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = this.now();
  }

  get usage() {
    return {
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      retries: this.retries,
      elapsedMs: this.now() - this.startedAt,
    };
  }

  checkDuration(): BudgetCheckResult {
    if (this.limits.maxWallClockMs === undefined) return { ok: true };
    const elapsed = this.now() - this.startedAt;
    if (elapsed >= this.limits.maxWallClockMs) {
      return { ok: false, kind: "max_duration", used: elapsed, limit: this.limits.maxWallClockMs };
    }
    return { ok: true };
  }

  checkModelCall(): BudgetCheckResult {
    if (this.limits.maxModelCalls !== undefined && this.modelCalls >= this.limits.maxModelCalls) {
      return { ok: false, kind: "max_model_calls", used: this.modelCalls, limit: this.limits.maxModelCalls };
    }
    return this.checkDuration();
  }

  recordModelCall() {
    this.modelCalls += 1;
  }

  checkToolCall(): BudgetCheckResult {
    if (this.limits.maxToolCalls !== undefined && this.toolCalls >= this.limits.maxToolCalls) {
      return { ok: false, kind: "max_tool_calls", used: this.toolCalls, limit: this.limits.maxToolCalls };
    }
    return this.checkDuration();
  }

  recordToolCall() {
    this.toolCalls += 1;
  }

  /**
   * Called after a failed attempt has already recorded a retry. `maxRetries`
   * means "N retries beyond the first attempt are tolerated", so exhaustion
   * requires `retries` to strictly exceed the limit (an intentional `>`,
   * not `>=`) — otherwise the very first failure would already exhaust a
   * `maxRetries: 1` budget without ever retrying.
   */
  checkRetry(): BudgetCheckResult {
    if (this.limits.maxRetries !== undefined && this.retries > this.limits.maxRetries) {
      return { ok: false, kind: "max_retries", used: this.retries, limit: this.limits.maxRetries };
    }
    return this.checkDuration();
  }

  recordRetry() {
    this.retries += 1;
  }
}

/** Bounded exponential backoff with jitter. Never grows unbounded. */
export function backoffDelayMs(attempt: number, baseMs = 200, capMs = 5_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
}
