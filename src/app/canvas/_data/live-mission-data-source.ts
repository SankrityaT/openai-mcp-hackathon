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
import type {
  CardeaMissionHttpClient,
  CreatedMission,
} from "@/core/contracts/mission-http-client";
import { STARTER_PASSES } from "@/core/board/passes";
import { MissionHttpError } from "@/core/contracts/mission-http-client";
import { deriveMissionStage, isTerminalMissionStage } from "@/core/contracts/mission-stage";
import type { JsonValue, MissionEvent, MissionSnapshot } from "@/core/contracts/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MissionActivityEntry, MissionRealtimeState } from "./apply-mission-event";
import { applyMissionEvent, createEmptyRealtimeState } from "./apply-mission-event";
import type { MissionActivityHint, RealtimeClientLike } from "./mission-realtime";
import { MissionRealtimeSubscriber } from "./mission-realtime";

const GOAL_LIMIT = 8_000;
const INSTRUCTION_LIMIT = 4_000;
const NOTE_LIMIT = 2_000;

export type LiveMissionDataSourceOptions = {
  client: CardeaMissionHttpClient;
  /** Called whenever the committed snapshot changes, for realtime consumers. */
  onSnapshot?: (snapshot: MissionSnapshot | null) => void;
  /**
   * Called once per committed event this source folded into the snapshot, in
   * the same strict sequence order the reducer saw it. Purely observational:
   * the activity rail reads it, and nothing about the snapshot depends on it.
   */
  onEvent?: (event: MissionEvent) => void;
  /** Called when the server rejects the session, so the seam can degrade truthfully. */
  onSessionLost?: () => void;
  /** Called when the server could not be reached at all. */
  onServerUnavailable?: () => void;
  /**
   * Realtime-capable Supabase client. Structurally typed (see
   * `RealtimeClientLike` in `./mission-realtime`) so tests can inject a fake
   * instead of a live connection. Defaults to a lazily created browser client
   * built from `createSupabaseBrowserClient()`; realtime is a background
   * enhancement, so a failure to construct or connect it never blocks the
   * REST-backed mission state this class is otherwise responsible for.
   */
  realtimeClient?: RealtimeClientLike;
};

function correlationId(): string {
  return globalThis.crypto.randomUUID();
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

/** Narrows a created mission back to the committed snapshot fields alone. */
function committedSnapshot(created: CreatedMission): MissionSnapshot {
  return {
    mission: created.mission,
    mandate: created.mandate,
    nodes: created.nodes,
    edges: created.edges,
    pendingApprovals: created.pendingApprovals,
    latestSequence: created.latestSequence,
  };
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
  private realtimeState: MissionRealtimeState = createEmptyRealtimeState(null);
  private realtimeSubscriber: MissionRealtimeSubscriber | null = null;
  private realtimeMissionId: string | null = null;
  private lazyRealtimeClient: RealtimeClientLike | null = null;

  constructor(private readonly options: LiveMissionDataSourceOptions) {}

  private get client() {
    return this.options.client;
  }

  private setSnapshot(snapshot: MissionSnapshot | null) {
    this.snapshot = snapshot;
    this.options.onSnapshot?.(snapshot);
  }

  /**
   * Lazily builds (or reuses an injected) realtime-capable client. The
   * `SupabaseClient` returned by `createSupabaseBrowserClient()` carries a
   * much richer, overloaded `channel().on(...)` surface than
   * `RealtimeClientLike` declares; the cast bridges that gap deliberately —
   * it is verified against `@supabase/supabase-js` 2.112.4's
   * `postgres_changes` INSERT overload, not a blind escape hatch.
   */
  private getRealtimeClient(): RealtimeClientLike | null {
    if (this.options.realtimeClient) return this.options.realtimeClient;
    if (this.lazyRealtimeClient) return this.lazyRealtimeClient;
    try {
      this.lazyRealtimeClient = createSupabaseBrowserClient() as unknown as RealtimeClientLike;
      return this.lazyRealtimeClient;
    } catch {
      // createSupabaseBrowserClient() throws when Supabase env vars are
      // unconfigured (e.g. a fixture-only deployment). Realtime is a
      // background enhancement; REST-backed state stays truthful without it.
      return null;
    }
  }

  private disposeRealtimeSubscriber(): void {
    this.realtimeSubscriber?.dispose();
    this.realtimeSubscriber = null;
    this.realtimeMissionId = null;
  }

  private startRealtime(missionId: string, startingSequence: number): void {
    this.disposeRealtimeSubscriber();
    const realtimeClient = this.getRealtimeClient();
    if (!realtimeClient) return;
    try {
      const subscriber = new MissionRealtimeSubscriber({
        client: realtimeClient,
        missionId,
        startingSequence,
        fetchEventsSince: (afterSequence, signal) => this.client.listEvents(missionId, afterSequence, signal),
        onEvent: (event) => this.handleRealtimeEvent(missionId, event),
        onUnrecoverableGap: () => {
          void this.resyncAfterGap(missionId);
        },
        activityHint: () => this.activityHint(),
      });
      this.realtimeMissionId = missionId;
      this.realtimeSubscriber = subscriber;
      subscriber.start();
    } catch {
      // Same rationale as getRealtimeClient(): never let realtime setup
      // failures affect the REST-backed mission state.
    }
  }

  /**
   * Tells the subscriber how fast to poll when realtime is silent. Guest and
   * judge sessions never receive `postgres_changes` rows, so this is the only
   * signal keeping their cadence honest: fast while work is visibly moving,
   * slow otherwise, and off once nothing more can be committed.
   */
  private activityHint(): MissionActivityHint {
    const snapshot = this.snapshot;
    const stage = deriveMissionStage(snapshot);
    const movingNode =
      snapshot?.nodes.some(
        (node) => node.status === "running" || node.status === "needs_approval",
      ) ?? false;
    return {
      hot: stage === "planning" || movingNode,
      terminal: isTerminalMissionStage(stage),
    };
  }

  /**
   * The bounded, deduped log of every event folded into the current snapshot,
   * oldest first. Read-only view for callers that want history without
   * subscribing to `onEvent`.
   */
  getActivity(): readonly MissionActivityEntry[] {
    return this.realtimeState.activity;
  }

  private handleRealtimeEvent(missionId: string, event: MissionEvent): void {
    if (this.realtimeMissionId !== missionId) return;
    this.realtimeState = applyMissionEvent(this.realtimeState, event);
    this.options.onEvent?.(event);
    if (this.realtimeState.needsResync) {
      void this.resyncAfterGap(missionId);
      return;
    }
    if (this.realtimeState.snapshot) {
      // Streamed events only reach the UI once they land here, in committed
      // sequence order — this never runs ahead of what the reducer confirmed.
      this.setSnapshot(this.realtimeState.snapshot);
    }
  }

  /**
   * Refetches full materialized state and resumes the subscriber from the
   * fresh baseline. `refresh()` itself resets the realtime baseline once the
   * fetch lands; this just guards against a mission switch racing the fetch.
   */
  private async resyncAfterGap(missionId: string): Promise<void> {
    if (this.realtimeMissionId !== missionId) return;
    await this.refresh(missionId);
  }

  /**
   * Re-reads committed state after a mutation. Never invents a version.
   *
   * This is a REST read outside the realtime reducer's sequence, so the
   * realtime baseline is reset to match it afterwards. Without this, a
   * committed event arriving over the realtime channel after a REST mutation
   * would be applied against the reducer's stale pre-mutation snapshot and
   * could overwrite the newer REST-fetched state with a regression.
   */
  private async refresh(missionId: string, signal?: AbortSignal) {
    try {
      const snapshot = await this.client.getMission(missionId, signal);
      this.setSnapshot(snapshot);
      if (this.realtimeMissionId === missionId) {
        this.realtimeState = createEmptyRealtimeState(snapshot);
        this.realtimeSubscriber?.resyncTo(snapshot?.latestSequence ?? 0);
      }
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
        mandateApproved: null,
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
      mandateApproved: Boolean(snapshot.mandate.approvedAt),
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

  /**
   * Loads an existing committed mission, e.g. after a reload, and starts
   * streaming its subsequent events. Switching missions (calling `adopt`
   * again with a different id) tears down the previous subscription first;
   * calling it again with the same id restarts the subscription from the
   * freshly fetched sequence, which is always safe since delivery is
   * idempotent.
   */
  async adopt(missionId: string, signal?: AbortSignal): Promise<MissionSnapshot | null> {
    this.disposeRealtimeSubscriber();
    const snapshot = await this.client.getMission(missionId, signal);
    this.setSnapshot(snapshot);
    this.realtimeState = createEmptyRealtimeState(snapshot);
    if (snapshot) this.startRealtime(missionId, snapshot.latestSequence);
    return snapshot;
  }

  /**
   * Tears down any active realtime subscription and clears committed state.
   * Safe to call multiple times. Use before abandoning this data source
   * instance (e.g. sign-out, unmount) so the underlying channel is released.
   */
  dispose(): void {
    this.disposeRealtimeSubscriber();
    this.realtimeState = createEmptyRealtimeState(null);
    this.setSnapshot(null);
  }

  async createMission(
    input: {
      goal: string;
      title?: string;
      selectedContextCardIds?: string[];
      freePassage?: boolean;
      /**
       * Spending boundary in micro-units from the wallet's loaded passes.
       * Zero or absent keeps the default (no autonomous spend either way;
       * this is the ceiling approvals may authorize against).
       */
      budgetMicrounits?: number;
    },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const goal = bounded(input.goal, GOAL_LIMIT);
    const selectedContextCardIds = (input.selectedContextCardIds ?? []).slice(0, 100);
    // Starter wallet passes are client-pinned ids with no context_cards row,
    // and the create_mission guard rejects any persisted id outside the
    // tenant. Passes therefore ride only as visible constraints (below) plus
    // the budget ceiling; the DB-validated list keeps real tenant cards only.
    const starterPassLabels = new Map(STARTER_PASSES.map((pass) => [pass.id, pass.label]));
    const persistedContextCardIds = selectedContextCardIds.filter(
      (id) =>
        !starterPassLabels.has(id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    );
    try {
      const created = await this.client.createMission(
        {
          title: input.title ?? deriveMissionTitle(goal),
          goal,
          constraints: selectedContextCardIds.map((id) => ({
            contextCard: bounded(starterPassLabels.get(id) ?? id, 120),
            source: "visible_context_wallet",
          })),
          authority: {
            ...DEFAULT_MISSION_AUTHORITY,
            freePassage: input.freePassage ?? false,
          },
          selectedContextCardIds: persistedContextCardIds,
          budgetLimits: {
            ...DEFAULT_MISSION_BUDGET_LIMITS,
            ...(input.budgetMicrounits && input.budgetMicrounits > 0
              ? { maxCostMicrounits: Math.floor(input.budgetMicrounits) }
              : {}),
          } as unknown as JsonValue,
          correlationId: correlationId(),
        },
        options.signal,
      );
      // `planning` is the server's handoff report, not mission state, so it is
      // dropped here and the committed snapshot stays exactly a snapshot.
      const snapshot = committedSnapshot(created);
      this.setSnapshot(snapshot);
      this.realtimeState = createEmptyRealtimeState(snapshot);
      this.startRealtime(snapshot.mission.id, snapshot.latestSequence);
      return this.succeeded("create_mission", "mandate_opened", {
        sequence: snapshot.latestSequence,
      });
    } catch (error) {
      return this.failed("create_mission", error);
    }
  }

  async approveMandate(
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("approve_mandate");
    if (!("mission" in current)) return current;
    const correlation = correlationId();
    try {
      const event = await this.client.appendEvent(
        current.mission.id,
        {
          expectedSequence: current.mission.lastEventSequence,
          type: "mandate.approved",
          correlationId: correlation,
          idempotencyKey: `mandate.approved:${current.mandate.version}`,
          payload: { version: current.mandate.version },
          trust: "trusted",
        },
        options.signal,
      );
      await this.refresh(current.mission.id, options.signal);
      return this.succeeded("approve_mandate", "mandate_approved", {
        sequence: event.sequence,
      });
    } catch (error) {
      return this.failed("approve_mandate", error);
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
          payload: {
            mandate: {
              missionId: current.mission.id,
              version: current.mandate.version + 1,
              goal: current.mandate.goal,
              constraints: [
                ...current.mandate.constraints,
                {
                  instruction: bounded(input.instruction, INSTRUCTION_LIMIT),
                  source: "visible_scoped_instruction",
                },
              ],
              authority: current.mandate.authority,
              selectedContextCardIds: current.mandate.selectedContextCardIds,
            },
          },
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

  async setFreePassage(
    input: { enabled: boolean },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("update_mandate");
    if (!("mission" in current)) return current;
    // Already what the mandate says: nothing to revise, nothing to append.
    if (current.mandate.authority.freePassage === input.enabled) {
      return this.succeeded("update_mandate", "mandate_opened", {
        sequence: current.mission.lastEventSequence,
      });
    }
    const correlation = correlationId();
    try {
      const event = await this.client.appendEvent(
        current.mission.id,
        {
          expectedSequence: current.mission.lastEventSequence,
          type: "mandate.revised",
          correlationId: correlation,
          idempotencyKey: `mandate.revised:${correlation}`,
          payload: {
            mandate: {
              missionId: current.mission.id,
              version: current.mandate.version + 1,
              goal: current.mandate.goal,
              constraints: current.mandate.constraints,
              authority: { ...current.mandate.authority, freePassage: input.enabled },
              selectedContextCardIds: current.mandate.selectedContextCardIds,
            },
          },
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
    input: { decision: ApprovalDecision; note?: string; approvalId?: string },
    options: MissionActionOptions = {},
  ): Promise<MissionActionResult> {
    const current = this.requireMission("resolve_approval");
    if (!("mission" in current)) return current;
    // A named approval is settled exactly; only an unnamed call falls back to
    // the oldest pending one, so two open decisions can never be crossed.
    const approval = input.approvalId
      ? current.pendingApprovals.find((candidate) => candidate.id === input.approvalId)
      : current.pendingApprovals[0];
    if (!approval) {
      return missionActionFailure(
        "resolve_approval",
        "live",
        input.approvalId
          ? {
              code: "approval_not_found",
              message: "That approval is no longer pending on the live mission.",
            }
          : {
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
          missionId: current.mission.id,
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
