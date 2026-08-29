"use client";

import { useEffect, useRef } from "react";
import type { CardeaDataMode } from "@/core/contracts/data-mode";
import type {
  ApprovalDecision,
  MissionActionOptions,
  MissionActionResult,
  MissionSpineSummary,
  NodeControlAction,
} from "@/core/contracts/mission-data-source";
import type { ApprovalSummary } from "./board-mission-actions";

type NodeSummary = { id: string; codename: string; role: string; status: string };

export type CardeaWebMCPActions = {
  /** Truthful mode for every tool result. Never asserted, always read from the seam. */
  dataMode: CardeaDataMode;
  spine: MissionSpineSummary;
  stage: string;
  nodes: NodeSummary[];
  /**
   * Bounded content of the pending approvals, when the surface can read it.
   * Optional so a caller that only has the spine registers the tools unchanged;
   * `inspect_canvas` then reports an empty list rather than inventing content.
   */
  approvals?: ApprovalSummary[];
  selectedNodeId: string;
  createMission(goal: string, options?: MissionActionOptions): Promise<MissionActionResult>;
  updateMandate(
    instruction: string,
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  approveMandate(options?: MissionActionOptions): Promise<MissionActionResult>;
  focusNode(nodeId: string): boolean;
  redirectNode(
    nodeId: string,
    instruction: string,
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  setNodeState(
    nodeId: string,
    action: NodeControlAction,
    options?: MissionActionOptions,
  ): Promise<MissionActionResult>;
  /**
   * `approvalId` is trailing and optional so an existing caller that settles
   * whatever approval is visible keeps compiling untouched.
   */
  resolveApproval(
    decision: ApprovalDecision,
    note?: string,
    options?: MissionActionOptions,
    approvalId?: string,
  ): Promise<MissionActionResult>;
  openTakeover(nodeId: string): boolean;
};

const objectSchema = (properties: object, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

function text(value: unknown, maximum = 8_000) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error("Invalid bounded string input");
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool input");
  return value as Record<string, unknown>;
}

/** Bounded, deterministic tool result. Never returns transcripts or raw payloads. */
function toolResult(result: MissionActionResult) {
  return JSON.stringify({
    ok: result.ok,
    dataMode: result.dataMode,
    persisted: result.persisted,
    visibleEffect: result.visibleEffect,
    missionId: result.missionId,
    nodeId: result.nodeId,
    approvalId: result.approvalId,
    stateVersion: result.stateVersion,
    sequence: result.sequence,
    ...(result.failure
      ? { error: { code: result.failure.code, message: result.failure.message } }
      : {}),
  });
}

function uiResult(
  dataMode: CardeaDataMode,
  visibleEffect: string,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    ok: true,
    dataMode,
    // Focus and takeover only move the visible interface; they commit nothing.
    persisted: false,
    scope: "ui_local",
    visibleEffect,
    ...extra,
  });
}

function unknownNode(dataMode: CardeaDataMode, nodeId: string) {
  return JSON.stringify({
    ok: false,
    dataMode,
    persisted: false,
    scope: "ui_local",
    visibleEffect: "none",
    nodeId,
    error: { code: "unknown_node", message: "That node is not on the visible canvas." },
  });
}

export function useCardeaWebMCP(actions: CardeaWebMCPActions) {
  const latest = useRef(actions);

  useEffect(() => {
    latest.current = actions;
  }, [actions]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context) return;
    const controller = new AbortController();
    const register = (tool: CardeaWebMCPTool) =>
      context.registerTool(tool, { signal: controller.signal }).catch(() => undefined);

    void Promise.all([
      register({
        name: "create_mission",
        description: "Create a draft Cardea mission from a user goal and open its visible mandate for review.",
        inputSchema: objectSchema({ goal: { type: "string", minLength: 1, maxLength: 8000 } }, ["goal"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const goal = text(object(input).goal);
          return toolResult(await latest.current.createMission(goal, { signal: options?.signal }));
        },
      }),
      register({
        name: "inspect_canvas",
        description:
          "Read a bounded summary of the visible Cardea mission, nodes, states, and pending decisions. Each pending approval comes back with its question, its options, and its consequence, which you should relay to the person in their own words so they can choose.",
        inputSchema: objectSchema({}),
        annotations: { readOnlyHint: true },
        execute() {
          const current = latest.current;
          return JSON.stringify({
            dataMode: current.dataMode,
            persisted: current.spine.persisted,
            stage: current.stage,
            selectedNodeId: current.selectedNodeId,
            nodes: current.nodes.slice(0, 20),
            mission: {
              id: current.spine.missionId,
              status: current.spine.missionStatus,
              mandateVersion: current.spine.mandateVersion,
              stateVersion: current.spine.stateVersion,
              latestSequence: current.spine.latestSequence,
            },
            pendingApprovals: current.spine.pendingApprovalIds.length,
            approvals: current.approvals ?? [],
          });
        },
      }),
      register({
        name: "update_mandate",
        description: "Propose a bounded change to the visible Cardea mandate for the user to review.",
        inputSchema: objectSchema({ instruction: { type: "string", minLength: 1, maxLength: 4000 } }, ["instruction"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const instruction = text(object(input).instruction, 4_000);
          return toolResult(
            await latest.current.updateMandate(instruction, { signal: options?.signal }),
          );
        },
      }),
      register({
        name: "approve_mandate",
        description:
          "Approve the visible Cardea mandate so planning can begin. Ask the person and get their explicit yes before calling this: it is their decision, not yours. It approves the mandate exactly as shown and nothing more. It does not grant spending, sending, or account changes, which each still stop at their own approval on the canvas.",
        inputSchema: objectSchema({}),
        annotations: { readOnlyHint: false },
        async execute(_input, options) {
          return toolResult(await latest.current.approveMandate({ signal: options?.signal }));
        },
      }),
      register({
        name: "focus_node",
        description: "Focus one existing Cardea node in the visible canvas without changing mission state.",
        inputSchema: objectSchema({ nodeId: { type: "string", minLength: 1, maxLength: 120 } }, ["nodeId"]),
        annotations: { readOnlyHint: true },
        execute(input) {
          const nodeId = text(object(input).nodeId, 120);
          const current = latest.current;
          if (!current.focusNode(nodeId)) return unknownNode(current.dataMode, nodeId);
          return uiResult(current.dataMode, "node_focused", { nodeId });
        },
      }),
      register({
        name: "redirect_node",
        description: "Add a scoped user instruction to an existing Cardea node and open the visible composer.",
        inputSchema: objectSchema({
          nodeId: { type: "string", minLength: 1, maxLength: 120 },
          instruction: { type: "string", minLength: 1, maxLength: 4000 },
        }, ["nodeId", "instruction"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const value = object(input);
          const nodeId = text(value.nodeId, 120);
          const instruction = text(value.instruction, 4_000);
          return toolResult(
            await latest.current.redirectNode(nodeId, instruction, { signal: options?.signal }),
          );
        },
      }),
      register({
        name: "set_node_state",
        description: "Pause, resume, retry, or revert one Cardea node through validated visible controls.",
        inputSchema: objectSchema({
          nodeId: { type: "string", minLength: 1, maxLength: 120 },
          action: { type: "string", enum: ["pause", "resume", "retry", "revert"] },
        }, ["nodeId", "action"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const value = object(input);
          const nodeId = text(value.nodeId, 120);
          const action = String(value.action);
          if (!["pause", "resume", "retry", "revert"].includes(action)) {
            throw new Error("Invalid action");
          }
          return toolResult(
            await latest.current.setNodeState(nodeId, action as NodeControlAction, {
              signal: options?.signal,
            }),
          );
        },
      }),
      register({
        name: "resolve_approval",
        description:
          "Accept, modify, or reject a visible Cardea approval after explicit user confirmation. When several approvals are pending, pass the approvalId from inspect_canvas. For a question card, pass the person's chosen option as the note with decision modify, after they explicitly chose it.",
        inputSchema: objectSchema({
          decision: { type: "string", enum: ["accept", "modify", "reject"] },
          note: { type: "string", maxLength: 2000 },
          approvalId: { type: "string", minLength: 1, maxLength: 120 },
        }, ["decision"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const value = object(input);
          const decision = String(value.decision);
          if (!["accept", "modify", "reject"].includes(decision)) throw new Error("Invalid decision");
          // Omitted means "whatever approval is visible"; supplied is validated.
          const approvalId =
            value.approvalId === undefined ? undefined : text(value.approvalId, 120);
          return toolResult(
            await latest.current.resolveApproval(
              decision as ApprovalDecision,
              typeof value.note === "string" ? value.note : undefined,
              { signal: options?.signal },
              approvalId,
            ),
          );
        },
      }),
      register({
        name: "open_takeover",
        description: "Open Cardea's visible human takeover interface for an existing node.",
        inputSchema: objectSchema({ nodeId: { type: "string", minLength: 1, maxLength: 120 } }, ["nodeId"]),
        annotations: { readOnlyHint: false },
        execute(input) {
          const nodeId = text(object(input).nodeId, 120);
          const current = latest.current;
          if (!current.openTakeover(nodeId)) return unknownNode(current.dataMode, nodeId);
          return uiResult(current.dataMode, "takeover_opened", { nodeId, liveBrowser: false });
        },
      }),
    ]);

    return () => controller.abort();
  }, []);
}
