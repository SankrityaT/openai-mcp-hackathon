"use client";

import { useEffect, useRef } from "react";

type NodeSummary = { id: string; codename: string; role: string; status: string };

export type CardeaWebMCPActions = {
  stage: string;
  nodes: NodeSummary[];
  selectedNodeId: string;
  createMission(goal: string): void;
  updateMandate(instruction: string): void;
  focusNode(nodeId: string): boolean;
  redirectNode(nodeId: string, instruction: string): boolean;
  setNodeState(nodeId: string, action: "pause" | "resume" | "retry" | "revert"): boolean;
  resolveApproval(decision: "accept" | "modify" | "reject", note?: string): void;
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
        execute(input) {
          const goal = text(object(input).goal);
          latest.current.createMission(goal);
          return JSON.stringify({ status: "draft", visibleEffect: "mandate_opened" });
        },
      }),
      register({
        name: "inspect_canvas",
        description: "Read a bounded summary of the visible Cardea mission, nodes, states, and pending decisions.",
        inputSchema: objectSchema({}),
        annotations: { readOnlyHint: true },
        execute() {
          const current = latest.current;
          return JSON.stringify({
            stage: current.stage,
            selectedNodeId: current.selectedNodeId,
            nodes: current.nodes.slice(0, 20),
          });
        },
      }),
      register({
        name: "update_mandate",
        description: "Propose a bounded change to the visible Cardea mandate for the user to review.",
        inputSchema: objectSchema({ instruction: { type: "string", minLength: 1, maxLength: 4000 } }, ["instruction"]),
        execute(input) {
          const instruction = text(object(input).instruction, 4_000);
          latest.current.updateMandate(instruction);
          return JSON.stringify({ status: "proposed", visibleEffect: "mandate_opened" });
        },
      }),
      register({
        name: "focus_node",
        description: "Focus one existing Cardea node in the visible canvas without changing mission state.",
        inputSchema: objectSchema({ nodeId: { type: "string", minLength: 1, maxLength: 120 } }, ["nodeId"]),
        annotations: { readOnlyHint: true },
        execute(input) {
          const nodeId = text(object(input).nodeId, 120);
          if (!latest.current.focusNode(nodeId)) throw new Error("Unknown node");
          return JSON.stringify({ nodeId, visibleEffect: "node_focused" });
        },
      }),
      register({
        name: "redirect_node",
        description: "Add a scoped user instruction to an existing Cardea node and open the visible composer.",
        inputSchema: objectSchema({
          nodeId: { type: "string", minLength: 1, maxLength: 120 },
          instruction: { type: "string", minLength: 1, maxLength: 4000 },
        }, ["nodeId", "instruction"]),
        execute(input) {
          const value = object(input);
          const nodeId = text(value.nodeId, 120);
          const instruction = text(value.instruction, 4_000);
          if (!latest.current.redirectNode(nodeId, instruction)) throw new Error("Unknown node");
          return JSON.stringify({ status: "recorded", nodeId, visibleEffect: "scoped_composer_opened" });
        },
      }),
      register({
        name: "set_node_state",
        description: "Pause, resume, retry, or revert one Cardea node through validated visible controls.",
        inputSchema: objectSchema({
          nodeId: { type: "string", minLength: 1, maxLength: 120 },
          action: { type: "string", enum: ["pause", "resume", "retry", "revert"] },
        }, ["nodeId", "action"]),
        execute(input) {
          const value = object(input);
          const nodeId = text(value.nodeId, 120);
          const action = value.action;
          if (!["pause", "resume", "retry", "revert"].includes(String(action))) throw new Error("Invalid action");
          if (!latest.current.setNodeState(nodeId, action as "pause" | "resume" | "retry" | "revert")) {
            throw new Error("Unknown node");
          }
          return JSON.stringify({ status: "updated", nodeId, action });
        },
      }),
      register({
        name: "resolve_approval",
        description: "Accept, modify, or reject the currently visible Cardea approval after explicit user confirmation.",
        inputSchema: objectSchema({
          decision: { type: "string", enum: ["accept", "modify", "reject"] },
          note: { type: "string", maxLength: 2000 },
        }, ["decision"]),
        execute(input) {
          const value = object(input);
          const decision = String(value.decision) as "accept" | "modify" | "reject";
          if (!["accept", "modify", "reject"].includes(decision)) throw new Error("Invalid decision");
          latest.current.resolveApproval(decision, typeof value.note === "string" ? value.note : undefined);
          return JSON.stringify({ status: decision === "modify" ? "editing" : "resolved", decision });
        },
      }),
      register({
        name: "open_takeover",
        description: "Open Cardea's visible human takeover interface for an existing node.",
        inputSchema: objectSchema({ nodeId: { type: "string", minLength: 1, maxLength: 120 } }, ["nodeId"]),
        execute(input) {
          const nodeId = text(object(input).nodeId, 120);
          if (!latest.current.openTakeover(nodeId)) throw new Error("Unknown node");
          return JSON.stringify({ nodeId, visibleEffect: "takeover_opened", liveBrowser: false });
        },
      }),
    ]);

    return () => controller.abort();
  }, []);
}
