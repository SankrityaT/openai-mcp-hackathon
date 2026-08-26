import type {
  JsonValue,
  MissionApproval,
  MissionEdge,
  MissionEvent,
  MissionMaterializedState,
  MissionNode,
  MissionStatus,
  NodeStatus,
} from "../contracts/types";

export class MissionReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionReplayError";
  }
}

function objectPayload(payload: JsonValue): Record<string, JsonValue | undefined> {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new MissionReplayError("Event payload must be an object for materialization");
  }
  return payload;
}

function requireObject<T>(value: JsonValue | undefined, name: string): T {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new MissionReplayError(`${name} must be an object`);
  }
  return value as T;
}

function requireString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MissionReplayError(`${name} must be a non-empty string`);
  }
  return value;
}

function updateNodeStatus(
  state: MissionMaterializedState,
  event: MissionEvent,
  status: NodeStatus,
): MissionMaterializedState {
  if (!event.nodeId || !state.nodes[event.nodeId]) {
    throw new MissionReplayError(`${event.type} references an unknown node`);
  }
  const current = state.nodes[event.nodeId];
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [event.nodeId]: { ...current, status, version: current.version + 1 },
    },
  };
}

function updateMissionStatus(
  state: MissionMaterializedState,
  status: MissionStatus,
): MissionMaterializedState {
  return { ...state, mission: { ...state.mission, status } };
}

export function reduceMissionEvent(
  state: MissionMaterializedState | null,
  event: MissionEvent,
): MissionMaterializedState {
  const payload = objectPayload(event.payload);
  if (event.type === "mission.created") {
    if (state) {
      throw new MissionReplayError("mission.created can only be the first event");
    }
    const mission = requireObject<MissionMaterializedState["mission"]>(payload.mission, "payload.mission");
    return { mission, nodes: {}, edges: {}, approvals: {}, checkpointId: null };
  }
  if (!state) {
    throw new MissionReplayError("The event stream must begin with mission.created");
  }

  switch (event.type) {
    case "mission.completed":
      return updateMissionStatus(state, "completed");
    case "mission.failed":
      return updateMissionStatus(state, "failed");
    case "mission.cancelled":
      return updateMissionStatus(state, "cancelled");
    case "mandate.revised":
    case "mandate.approved": {
      const version = payload.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
        throw new MissionReplayError("Mandate events require a positive version");
      }
      return { ...state, mission: { ...state.mission, mandateVersion: version } };
    }
    case "node.planned": {
      const node = requireObject<MissionNode>(payload.node, "payload.node");
      if (node.missionId !== event.missionId || node.tenantId !== event.tenantId) {
        throw new MissionReplayError("Planned node is outside the event tenant or mission");
      }
      if (state.nodes[node.id]) {
        throw new MissionReplayError("Node was planned more than once");
      }
      return { ...state, nodes: { ...state.nodes, [node.id]: node } };
    }
    case "node.started":
    case "node.resumed":
      return updateNodeStatus(state, event, "running");
    case "node.paused":
      return updateNodeStatus(state, event, "paused");
    case "node.completed":
      return updateNodeStatus(state, event, "completed");
    case "node.failed":
      return updateNodeStatus(state, event, "failed");
    case "node.redirected": {
      if (!event.nodeId || !state.nodes[event.nodeId]) {
        throw new MissionReplayError("node.redirected references an unknown node");
      }
      const current = state.nodes[event.nodeId];
      const objective = requireString(payload.objective, "payload.objective");
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [event.nodeId]: { ...current, objective, version: current.version + 1 },
        },
      };
    }
    case "dependency.added": {
      const edge = requireObject<MissionEdge>(payload.edge, "payload.edge");
      if (edge.missionId !== event.missionId || edge.tenantId !== event.tenantId) {
        throw new MissionReplayError("Dependency is outside the event tenant or mission");
      }
      return { ...state, edges: { ...state.edges, [edge.id]: edge } };
    }
    case "dependency.removed": {
      const edgeId = requireString(payload.edgeId, "payload.edgeId");
      const edges = { ...state.edges };
      delete edges[edgeId];
      return { ...state, edges };
    }
    case "dependency.rerouted": {
      const removedEdgeId = requireString(payload.removedEdgeId, "payload.removedEdgeId");
      const edge = requireObject<MissionEdge>(payload.edge, "payload.edge");
      const edges = { ...state.edges };
      delete edges[removedEdgeId];
      edges[edge.id] = edge;
      return { ...state, edges };
    }
    case "approval.requested": {
      const approval = requireObject<MissionApproval>(payload.approval, "payload.approval");
      return { ...state, approvals: { ...state.approvals, [approval.id]: approval } };
    }
    case "approval.resolved":
    case "approval.expired": {
      const approvalId = requireString(payload.approvalId, "payload.approvalId");
      const approval = state.approvals[approvalId];
      if (!approval || approval.status !== "pending") {
        throw new MissionReplayError("Approval is missing or already settled");
      }
      const nextStatus = event.type === "approval.expired" ? "expired" : requireString(payload.status, "payload.status");
      if (!["resolved", "rejected"].includes(nextStatus) && event.type !== "approval.expired") {
        throw new MissionReplayError("Approval resolution has an invalid status");
      }
      return {
        ...state,
        approvals: {
          ...state.approvals,
          [approvalId]: {
            ...approval,
            status: nextStatus as MissionApproval["status"],
            resolvedAt: event.createdAt,
            resolution: payload.resolution ?? null,
          },
        },
      };
    }
    case "checkpoint.created":
      return { ...state, checkpointId: requireString(payload.checkpointId, "payload.checkpointId") };
    case "mission.reverted":
    case "node.reverted": {
      const snapshot = requireObject<MissionMaterializedState>(payload.snapshot, "payload.snapshot");
      if (snapshot.mission.id !== event.missionId || snapshot.mission.tenantId !== event.tenantId) {
        throw new MissionReplayError("Checkpoint snapshot belongs to a different mission");
      }
      return snapshot;
    }
    default:
      return state;
  }
}

export function replayMissionEvents(events: readonly MissionEvent[]): MissionMaterializedState {
  if (events.length === 0) {
    throw new MissionReplayError("Cannot replay an empty event stream");
  }
  const missionId = events[0].missionId;
  const tenantId = events[0].tenantId;
  let state: MissionMaterializedState | null = null;
  let expectedSequence = 1;
  const eventIds = new Set<string>();

  for (const event of events) {
    if (event.missionId !== missionId || event.tenantId !== tenantId) {
      throw new MissionReplayError("Event stream crosses a mission or tenant boundary");
    }
    if (event.sequence !== expectedSequence) {
      throw new MissionReplayError(`Expected sequence ${expectedSequence}, received ${event.sequence}`);
    }
    if (eventIds.has(event.id)) {
      throw new MissionReplayError(`Duplicate event id ${event.id}`);
    }
    eventIds.add(event.id);
    state = reduceMissionEvent(state, event);
    state = {
      ...state,
      mission: {
        ...state.mission,
        lastEventSequence: event.sequence,
        stateVersion: event.sequence,
        updatedAt: event.createdAt,
      },
    };
    expectedSequence += 1;
  }

  return state as MissionMaterializedState;
}

export function materializationMatches(
  stored: MissionMaterializedState,
  replayed: MissionMaterializedState,
): boolean {
  return JSON.stringify(stored) === JSON.stringify(replayed);
}
