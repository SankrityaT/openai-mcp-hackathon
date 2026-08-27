/**
 * Pure derivation for the budget-stop flag.
 *
 * When a mission node would commit real money beyond what the person loaded
 * onto their wallet passes, the harness stops the node before committing and
 * emits, in order (see `src/harness/execute-node.ts` `emitBudgetExhausted`):
 *
 *   1. `quota.consumed`  payload `{ kind: "cost", used, limit, exhausted: true }`
 *   2. `node.failed`     payload `{ nodeId, reason: "budget_exhausted", kind: "cost" }`
 *
 * `used` and `limit` are in microunits (1 USD = 1_000_000), matching
 * `src/core/board/passes.ts`. This module turns that pair of events into the
 * plain data `<BudgetFlag>` needs to render, with no React and no DOM, so it
 * can be asserted directly.
 */

import type { MissionEvent } from "@/core/contracts/types";

export type BudgetFlagInfo = {
  nodeId: string;
  nodeCodename: string;
  usedMicrounits: number;
  limitMicrounits: number;
};

/** The subset of a mission node this module needs to resolve a codename. */
export type BudgetFlagNode = {
  id: string;
  codename: string;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isCostBudgetFailure(event: MissionEvent): event is MissionEvent & { nodeId: string } {
  if (event.type !== "node.failed" || !event.nodeId) return false;
  const payload = readRecord(event.payload);
  return Boolean(payload) && payload!.reason === "budget_exhausted" && payload!.kind === "cost";
}

function isCostQuotaConsumed(event: MissionEvent, nodeId: string): boolean {
  if (event.type !== "quota.consumed" || event.nodeId !== nodeId) return false;
  const payload = readRecord(event.payload);
  return Boolean(payload) && payload!.kind === "cost" && payload!.exhausted === true;
}

/**
 * Finds the most recent budget-exhausted cost stop in `events` (oldest to
 * newest, the shape the board's activity buffer already keeps) and resolves
 * it into the amounts and codename `<BudgetFlag>` renders.
 *
 * Returns `null` when no such stop has happened yet, or when the stop's
 * `quota.consumed` amounts cannot be found: the flag has nothing truthful to
 * show without them, so it is better to render nothing than a guess.
 *
 * `nodes` supplies the codename lookup. When the failed node is not present
 * in `nodes` (a stale reference, a node pruned from the board), the node id
 * is used as the codename so the flag can still render.
 */
export function deriveBudgetFlag(
  events: readonly MissionEvent[],
  nodes: readonly BudgetFlagNode[],
): BudgetFlagInfo | null {
  let failure: (MissionEvent & { nodeId: string }) | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isCostBudgetFailure(event)) {
      failure = event;
      break;
    }
  }
  if (!failure) return null;

  let usedMicrounits: number | null = null;
  let limitMicrounits: number | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isCostQuotaConsumed(event, failure.nodeId)) continue;
    const payload = readRecord(event.payload)!;
    usedMicrounits = readNonNegativeInteger(payload.used);
    limitMicrounits = readNonNegativeInteger(payload.limit);
    break;
  }
  if (usedMicrounits === null || limitMicrounits === null) return null;

  const node = nodes.find((candidate) => candidate.id === failure!.nodeId);

  return {
    nodeId: failure.nodeId,
    nodeCodename: node?.codename ?? failure.nodeId,
    usedMicrounits,
    limitMicrounits,
  };
}
