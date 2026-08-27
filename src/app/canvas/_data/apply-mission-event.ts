/**
 * Pure client-side reducer that materializes committed `MissionEvent`s onto
 * the array-shaped `MissionSnapshot` the canvas renders.
 *
 * This mirrors the server-side replay in `src/core/events/replay.ts`, which
 * performs the equivalent materialization on the record-shaped
 * `MissionMaterializedState` used by the repository layer. The two shapes
 * diverge (arrays here vs. id-keyed records there), so the mapping is
 * reimplemented rather than shared, but the event-to-effect semantics are
 * kept identical on purpose.
 *
 * Contract:
 * - Never throws. An event this reducer cannot safely reconcile against the
 *   current snapshot (an out-of-band `mission.created`, a revert whose
 *   payload carries the server's record-shaped materialization rather than
 *   an array-shaped one, an unknown node reference, a duplicate `node.planned`,
 *   etc.) sets `needsResync: true` instead of guessing. The caller
 *   (`LiveMissionDataSource`) treats that as a signal to refetch materialized
 *   state from `GET /api/missions/:id`, never as a thrown error.
 * - Every event, materializing or not, is recorded into a bounded `activity`
 *   log (deduped by event id) and advances the mission's sequence bookkeeping
 *   (`lastEventSequence`, `stateVersion`, `updatedAt`, `latestSequence`) so a
 *   truthful "as of sequence N" can always be shown, even for event families
 *   the canvas does not render as structural state (tool/evidence/memory/
 *   capability/quota/policy/security).
 * - Applying an event whose sequence is not newer than the current
 *   `latestSequence` is a no-op beyond recording it in `activity` once. This
 *   makes the reducer itself idempotent under at-least-once delivery, on top
 *   of whatever ordering/dedupe the realtime subscriber already does.
 */

// Relative, not aliased: this value import must resolve under plain `tsc`
// + `node:test` (no path-alias runtime resolver), matching the convention
// already used for cross-package value imports in src/harness/*.ts.
import { MISSION_EVENT_CATALOGUE } from "../../../core/events/catalogue";
import type {
  MissionApproval,
  MissionEdge,
  MissionEvent,
  MissionEventType,
  MissionNode,
  MissionSnapshot,
} from "@/core/contracts/types";

export type MissionActivityEntry = {
  id: string;
  sequence: number;
  type: MissionEventType;
  nodeId?: string;
  createdAt: string;
};

export type MissionRealtimeState = {
  snapshot: MissionSnapshot | null;
  /** Bounded, oldest-first log of every committed event seen (deduped by id). */
  activity: MissionActivityEntry[];
  /**
   * True when the last applied event could not be safely reconciled and the
   * caller should refetch full materialized state. Cleared by starting a
   * fresh `MissionRealtimeState` from the refetched snapshot.
   */
  needsResync: boolean;
};

/** Caps memory for long-running missions; overflow drops the oldest entries. */
export const ACTIVITY_LOG_LIMIT = 200;

export function createEmptyRealtimeState(snapshot: MissionSnapshot | null = null): MissionRealtimeState {
  return { snapshot, activity: [], needsResync: false };
}

class MaterializeError extends Error {}

function pushActivity(
  activity: MissionActivityEntry[],
  event: MissionEvent,
): MissionActivityEntry[] {
  if (activity.some((entry) => entry.id === event.id)) return activity;
  const next = [
    ...activity,
    {
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      nodeId: event.nodeId,
      createdAt: event.createdAt,
    },
  ];
  return next.length > ACTIVITY_LOG_LIMIT ? next.slice(next.length - ACTIVITY_LOG_LIMIT) : next;
}

function bumpSequence(snapshot: MissionSnapshot, event: MissionEvent): MissionSnapshot {
  return {
    ...snapshot,
    latestSequence: event.sequence,
    mission: {
      ...snapshot.mission,
      lastEventSequence: event.sequence,
      stateVersion: event.sequence,
      updatedAt: event.createdAt,
    },
  };
}

function objectPayload(event: MissionEvent): Record<string, unknown> {
  const payload = event.payload;
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new MaterializeError(`${event.type} payload must be an object`);
  }
  return payload as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MaterializeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireObject<T>(value: unknown, name: string): T {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new MaterializeError(`${name} must be an object`);
  }
  return value as T;
}

function requireNodeId(event: MissionEvent): string {
  if (!event.nodeId) throw new MaterializeError(`${event.type} requires nodeId`);
  return event.nodeId;
}

function replaceNode(
  nodes: MissionNode[],
  nodeId: string,
  patch: Partial<MissionNode>,
): MissionNode[] {
  let found = false;
  const next = nodes.map((node) => {
    if (node.id !== nodeId) return node;
    found = true;
    return { ...node, ...patch, version: node.version + 1 };
  });
  if (!found) throw new MaterializeError(`Unknown node ${nodeId}`);
  return next;
}

/**
 * Applies one materializing event to a snapshot. Only called when the event
 * catalogue marks the event type as materializing; every case below
 * corresponds 1:1 with a `materializes: true` entry in
 * `src/core/events/catalogue.ts`.
 */
function materialize(snapshot: MissionSnapshot, event: MissionEvent): MissionSnapshot {
  const payload = objectPayload(event);

  switch (event.type) {
    case "mission.completed":
      return { ...snapshot, mission: { ...snapshot.mission, status: "completed" } };
    case "mission.failed":
      return { ...snapshot, mission: { ...snapshot.mission, status: "failed" } };
    case "mission.cancelled":
      return { ...snapshot, mission: { ...snapshot.mission, status: "cancelled" } };

    case "mandate.revised":
    case "mandate.approved": {
      const version = payload.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
        throw new MaterializeError(`${event.type} requires a positive payload.version`);
      }
      return { ...snapshot, mission: { ...snapshot.mission, mandateVersion: version } };
    }

    case "node.planned": {
      const node = requireObject<MissionNode>(payload.node, "payload.node");
      if (snapshot.nodes.some((existing) => existing.id === node.id)) {
        throw new MaterializeError("Node was planned more than once");
      }
      return { ...snapshot, nodes: [...snapshot.nodes, node] };
    }
    case "node.started":
    case "node.resumed":
      return { ...snapshot, nodes: replaceNode(snapshot.nodes, requireNodeId(event), { status: "running" }) };
    case "node.paused":
      return { ...snapshot, nodes: replaceNode(snapshot.nodes, requireNodeId(event), { status: "paused" }) };
    case "node.completed":
      return { ...snapshot, nodes: replaceNode(snapshot.nodes, requireNodeId(event), { status: "completed" }) };
    case "node.failed":
      return { ...snapshot, nodes: replaceNode(snapshot.nodes, requireNodeId(event), { status: "failed" }) };
    case "node.redirected": {
      const objective = requireString(payload.objective, "payload.objective");
      return { ...snapshot, nodes: replaceNode(snapshot.nodes, requireNodeId(event), { objective }) };
    }

    case "dependency.added": {
      const edge = requireObject<MissionEdge>(payload.edge, "payload.edge");
      if (snapshot.edges.some((existing) => existing.id === edge.id)) return snapshot;
      return { ...snapshot, edges: [...snapshot.edges, edge] };
    }
    case "dependency.removed": {
      const edgeId = requireString(payload.edgeId, "payload.edgeId");
      return { ...snapshot, edges: snapshot.edges.filter((edge) => edge.id !== edgeId) };
    }
    case "dependency.rerouted": {
      const removedEdgeId = requireString(payload.removedEdgeId, "payload.removedEdgeId");
      const edge = requireObject<MissionEdge>(payload.edge, "payload.edge");
      const withoutOld = snapshot.edges.filter((existing) => existing.id !== removedEdgeId);
      return { ...snapshot, edges: [...withoutOld, edge] };
    }

    case "approval.requested": {
      const approval = requireObject<MissionApproval>(payload.approval, "payload.approval");
      const withoutExisting = snapshot.pendingApprovals.filter((existing) => existing.id !== approval.id);
      return { ...snapshot, pendingApprovals: [...withoutExisting, approval] };
    }
    case "approval.resolved":
    case "approval.expired": {
      const approvalId = requireString(payload.approvalId, "payload.approvalId");
      return {
        ...snapshot,
        pendingApprovals: snapshot.pendingApprovals.filter((approval) => approval.id !== approvalId),
      };
    }

    case "checkpoint.created":
      // MissionSnapshot has no client-visible checkpoint field; sequence
      // bookkeeping and the activity log already record this event.
      return snapshot;

    case "mission.created":
    case "mission.reverted":
    case "node.reverted":
      // mission.created must be the first event for a mission and is always
      // consumed by the initial GET before a subscription starts. Reverts
      // carry the server's record-shaped MissionMaterializedState, which
      // cannot be safely reconstructed into the array-shaped MissionSnapshot
      // from the payload alone. Both cases refetch instead of guessing.
      throw new MaterializeError(`${event.type} cannot be applied incrementally; refetch required`);

    default:
      // Defensive: any catalogue entry marked materializing but not handled
      // above is a reducer gap, not a license to silently do nothing.
      throw new MaterializeError(`Unhandled materializing event type: ${event.type}`);
  }
}

/**
 * Applies one committed event to realtime state. Pure and total: every input
 * produces a defined output, never a throw.
 */
export function applyMissionEvent(state: MissionRealtimeState, event: MissionEvent): MissionRealtimeState {
  // Idempotent no-op for an event already folded into this state (at-least-once redelivery).
  if (state.activity.some((entry) => entry.id === event.id)) {
    return state;
  }
  if (state.snapshot && event.sequence <= state.snapshot.latestSequence) {
    return { ...state, activity: pushActivity(state.activity, event), needsResync: false };
  }

  const activity = pushActivity(state.activity, event);

  if (!state.snapshot) {
    // Nothing to materialize onto yet; the caller must adopt/refetch first.
    return { snapshot: null, activity, needsResync: true };
  }

  const definition = MISSION_EVENT_CATALOGUE[event.type];
  if (!definition?.materializes) {
    return { snapshot: bumpSequence(state.snapshot, event), activity, needsResync: false };
  }

  try {
    const materialized = materialize(state.snapshot, event);
    return { snapshot: bumpSequence(materialized, event), activity, needsResync: false };
  } catch {
    return { snapshot: state.snapshot, activity, needsResync: true };
  }
}
