"use client";

import type {
  ApprovalDecision,
  MissionActionName,
  MissionActionOptions,
  MissionActionResult,
  MissionDataSource,
  MissionSpineSummary,
  NodeControlAction,
} from "@/core/contracts/mission-data-source";
import {
  DEFAULT_MISSION_AUTHORITY,
  DEFAULT_MISSION_BUDGET_LIMITS,
  deriveMissionTitle,
  MISSION_SPINE_NODE_LIMIT,
  missionActionFailure,
} from "@/core/contracts/mission-data-source";
import type { CardeaMissionHttpClient } from "@/core/contracts/mission-http-client";
import { MissionHttpError } from "@/core/contracts/mission-http-client";
import type { JsonValue, MissionSnapshot } from "@/core/contracts/types";

const GOAL_LIMIT = 8_000;
const INSTRUCTION_LIMIT = 4_000;
const NOTE_LIMIT = 2_000;

export type LiveMissionDataSourceOptions = {
  client: CardeaMissionHttpClient;
  /** Called whenever the committed snapshot changes, for realtime consumers. */
  onSnapshot?: (snapshot: MissionSnapshot | null) => void;
  /** Called when the server rejects the session, so the seam can degrade truthfully. */
  onSessionLost?: () => void;
  /** Called when the server could not be reached at all. */
  onServerUnavailable?: () => void;
};

function correlationId(): string {
  return globalThis.crypto.randomUUID();
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

/**
 * Live implementation of the mission seam.
 *
 * Every mutation is a round trip to a Cardea route that commits a mission event
 * or settles an approval. Results always carry the server's mission id, state
 * version, and committed sequence so callers can report exactly what happened.
 */
export class LiveMissionDataSource implements MissionDataSource {
  readonly mode = "live" as const;

  private snapshot: MissionSnapshot | null = null;

  constructor(private readonly options: LiveMissionDataSourceOptions) {}

  private get client() {
    return this.options.client;
  }

  private setSnapshot(snapshot: MissionSnapshot | null) {
    this.snapshot = snapshot;
    this.options.onSnapshot?.(snapshot);
  }

  /** Re-reads committed state after a mutation. Never invents a version. */
  private async refresh(missionId: string, signal?: AbortSignal) {
    try {
      this.setSnapshot(await this.client.getMission(missionId, signal));
    } catch {
      // Keep the last committed snapshot; the next action reports the failure.
    }
  }

  private succeeded(
    action: MissionActionName,
    visibleEffect: string,
    extra: { nodeId?: string | null; approvalId?: string | null; sequence?: number | null },
  ): MissionActionResult {
    const mission = this.snapshot?.mission ?? null;
    return {
      ok: true,
      action,
      dataMode: "live",
      persisted: true,
      visibleEffect,
      missionId: mission?.id ?? null,
      nodeId: extra.nodeId ?? null,
      approvalId: extra.approvalId ?? null,
      stateVersion: mission?.stateVersion ?? null,
      sequence: extra.sequence ?? this.snapshot?.latestSequence ?? null,
    };
  }

  private failed(action: MissionActionName, error: unknown): MissionActionResult {
    const missionId = this.snapshot?.mission.id ?? null;
    if (!(error instanceof MissionHttpError)) {
      this.options.onServerUnavailable?.();
      return missionActionFailure(
        action,
        "live",
        {
          code: "server_unavailable",
          message: "Cardea could not complete that action. Nothing was recorded.",
        },
        { missionId },
      );
    }

    if (error.status === 401) {
      this.options.onSessionLost?.();
      return missionActionFailure(
        action,
        "live",
        {
          code: "unauthenticated",
          message: "Your Cardea session has expired. Sign in again to keep persisting work.",
        },
        { missionId },
      );
    }
    if (error.denial) {
      return missionActionFailure(
        action,
        "live",
        {
          code: "quota_denied",
          message: "This action is outside the current allowance. Nothing was recorded.",
          denial: error.denial,
        },
        { missionId },
      );
    }
    if (error.status === 403) {
      return missionActionFailure(
        action,
        "live",
        { code: "policy_denied", message: "Cardea policy refused that action." },
        { missionId },
      );
    }
    if (error.status === 409) {
      return missionActionFailure(
        action,
        "live",
        {
          code: "stale_state",
          message: "The mission moved on before this action landed. Refresh and retry.",
        },
        { missionId },
      );
    }
    if (error.status === 400 || error.status === 404) {
      return missionActionFailure(
        action,
        "live",
        { code: "invalid_request", message: "Cardea rejected that request as invalid." },
        { missionId },
      );
    }
    this.options.onServerUnavailable?.();
    return missionActionFailure(
      action,
      "live",
      {
        code: "server_unavailable",
        message: "Cardea could not complete that action. Nothing was recorded.",
      },
      { missionId },
    );
  }

  private requireMission(action: MissionActionName): MissionSnapshot | MissionActionResult {
    if (this.snapshot) return this.snapshot;
    return missionActionFailure(action, "live", {
      code: "no_active_mission",
      message: "There is no live mission yet. Create one first.",
    });
  }

  summarize(): MissionSpineSummary {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return {
        dataMode: "live",
        persisted: true,
        missionId: null,
        missionStatus: null,
        mandateVersion: null,
        stateVersion: null,
        latestSequence: null,
        nodes: [],
        pendingApprovalIds: [],
      };
    }
    return {
      dataMode: "live",
      persisted: true,
      missionId: snapshot.mission.id,
      missionStatus: snapshot.mission.status,
      mandateVersion: snapshot.mission.mandateVersion,
      stateVersion: snapshot.mission.stateVersion,
      latestSequence: snapshot.latestSequence,
      nodes: snapshot.nodes.slice(0, MISSION_SPINE_NODE_LIMIT).map((node) => ({
        id: node.id,
        codename: node.codename,
        roleLabel: node.roleLabel,
        status: node.status,
      })),
      pendingApprovalIds: snapshot.pendingApprovals.map((approval) => approval.id),
    };
  }

  /** Loads an existing committed mission, e.g. after a reload. */
  async adopt(missionId: string, signal?: AbortSignal): Promise<MissionSnapshot | null> {
    const snapshot = await this.client.getMission(missionId, signal);
    this.setSnapshot(snapshot);
    return snapshot;
  }

  async createMission(
    input: { goal: string; title?: string },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const goal = bounded(input.goal, GOAL_LIMIT);
    try {
      const snapshot = await this.client.createMission(
        {
          title: input.title ?? deriveMissionTitle(goal),
          goal,
          constraints: [],
          authority: DEFAULT_MISSION_AUTHORITY,
          selectedContextCardIds: [],
          budgetLimits: DEFAULT_MISSION_BUDGET_LIMITS as unknown as JsonValue,
          correlationId: correlationId(),
        },
        options.signal,
      );
      this.setSnapshot(snapshot);
      return this.succeeded("create_mission", "mandate_opened", {
        sequence: snapshot.latestSequence,
      });
    } catch (error) {
      return this.failed("create_mission", error);
    }
  }

  async updateMandate(
    input: { instruction: string },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("update_mandate");
    if (!("mission" in current)) return current;
    const correlation = correlationId();
    try {
      const event = await this.client.appendEvent(
        current.mission.id,
        {
          expectedSequence: current.mission.lastEventSequence,
          type: "mandate.revised",
          correlationId: correlation,
          idempotencyKey: `mandate.revised:${correlation}`,
          payload: { instruction: bounded(input.instruction, INSTRUCTION_LIMIT) },
          trust: "trusted",
        },
        options.signal,
      );
      await this.refresh(current.mission.id, options.signal);
      return this.succeeded("update_mandate", "mandate_opened", { sequence: event.sequence });
    } catch (error) {
      return this.failed("update_mandate", error);
    }
  }

  private findNode(nodeId: string) {
    return this.snapshot?.nodes.find((node) => node.id === nodeId) ?? null;
  }

  async redirectNode(
    input: { nodeId: string; instruction: string },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("redirect_node");
    if (!("mission" in current)) return current;
    if (!this.findNode(input.nodeId)) {
      return missionActionFailure(
        "redirect_node",
        "live",
        {
          code: "unknown_node",
          message: "That node is not part of the live mission.",
        },
        { missionId: current.mission.id },
      );
    }
    const correlation = correlationId();
    try {
      const event = await this.client.appendEvent(
        current.mission.id,
        {
          expectedSequence: current.mission.lastEventSequence,
          type: "node.redirected",
          correlationId: correlation,
          idempotencyKey: `node.redirected:${correlation}`,
          nodeId: input.nodeId,
          payload: { instruction: bounded(input.instruction, INSTRUCTION_LIMIT) },
          trust: "trusted",
        },
        options.signal,
      );
      await this.refresh(current.mission.id, options.signal);
      return this.succeeded("redirect_node", "scoped_composer_opened", {
        nodeId: input.nodeId,
        sequence: event.sequence,
      });
    } catch (error) {
      return this.failed("redirect_node", error);
    }
  }

  async setNodeState(
    input: { nodeId: string; action: NodeControlAction },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("set_node_state");
    if (!("mission" in current)) return current;
    if (!this.findNode(input.nodeId)) {
      return missionActionFailure(
        "set_node_state",
        "live",
        { code: "unknown_node", message: "That node is not part of the live mission." },
        { missionId: current.mission.id },
      );
    }
    if (input.action !== "pause" && input.action !== "resume") {
      // Retry and revert settle through durable checkpoint work that this
      // deployment does not expose yet. Say so instead of faking a transition.
      return missionActionFailure(
        "set_node_state",
        "live",
        {
          code: "not_supported",
          message: `${input.action} is not available on the live spine yet; nothing was recorded.`,
        },
        { missionId: current.mission.id, nodeId: input.nodeId },
      );
    }

    const correlation = correlationId();
    const type = input.action === "pause" ? "node.paused" : "node.resumed";
    try {
      const event = await this.client.appendEvent(
        current.mission.id,
        {
          expectedSequence: current.mission.lastEventSequence,
          type,
          correlationId: correlation,
          idempotencyKey: `${type}:${correlation}`,
          nodeId: input.nodeId,
          nodeStatus: input.action === "pause" ? "paused" : "running",
          payload: {},
          trust: "trusted",
        },
        options.signal,
      );
      await this.refresh(current.mission.id, options.signal);
      return this.succeeded("set_node_state", `node_${input.action}`, {
        nodeId: input.nodeId,
        sequence: event.sequence,
      });
    } catch (error) {
      return this.failed("set_node_state", error);
    }
  }

  async resolveApproval(
    input: { decision: ApprovalDecision; note?: string },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("resolve_approval");
    if (!("mission" in current)) return current;
    const approval = current.pendingApprovals[0];
    if (!approval) {
      return missionActionFailure(
        "resolve_approval",
        "live",
        {
          code: "no_pending_approval",
          message: "The live mission has no pending approval to settle.",
        },
        { missionId: current.mission.id },
      );
    }

    const decision =
      input.decision === "accept"
        ? "accepted"
        : input.decision === "modify"
          ? "modified"
          : "rejected";

    try {
      const settled = await this.client.resolveApproval(
        approval.id,
        {
          decision,
          resolution: input.note ? { note: bounded(input.note, NOTE_LIMIT) } : {},
          correlationId: correlationId(),
          // Deterministic per approval and decision: an identical retry settles once.
          idempotencyKey: `approval:${approval.id}:${decision}`,
        },
        options.signal,
      );
      await this.refresh(current.mission.id, options.signal);
      return this.succeeded(
        "resolve_approval",
        input.decision === "modify" ? "approval_modify_opened" : "approval_resolved",
        { approvalId: settled.id, nodeId: settled.nodeId },
      );
    } catch (error) {
      return this.failed("resolve_approval", error);
    }
  }
}

export function createLiveMissionDataSource(
  options: LiveMissionDataSourceOptions,
): LiveMissionDataSource {
  return new LiveMissionDataSource(options);
}
