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
import type { ApprovalSummary, WalletPassSummary } from "./board-mission-actions";
import {
  MAX_OPEN_PAGES,
  openPagesResult,
  sanitizePageUrls,
  workspaceSwitchResult,
} from "./board-mission-actions";

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
  /**
   * The wallet's starter passes and their live selection, present only on
   * surfaces that mount a wallet. Selecting here only affects a mission not
   * yet created: once a mission's mandate is opened, `updateMandate` carries
   * `selectedContextCardIds` through unchanged, so this has no effect on a
   * mission already in progress.
   */
  wallet?: WalletPassSummary[];
  /** Returns false for a pass id that is not one of the person's starter passes. */
  toggleWalletPass?(id: string): boolean;
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
  /**
   * Opens sanitized https urls as live browser tiles on the canvas and
   * returns the urls it actually opened. Board-only, like the workspace
   * actions: a surface without canvas tiles simply never registers the tool.
   */
  openPages?(urls: string[]): string[];
  /**
   * The workspace strip, when the surface has one. Optional because `/canvas`
   * mounts a single board with no strip behind it: the two workspace tools are
   * only registered where these are actually present.
   */
  listMissions?(): Promise<WorkspaceMissionSummary[]>;
  /** Returns false for a mission the strip does not know about. */
  openMission?(missionId: string): boolean;
};

/** Structural mirror of `MissionListItem`; the tool surface reports it verbatim. */
export type WorkspaceMissionSummary = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

const objectSchema = (properties: object, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

function text(value: unknown, maximum = 8_000, field = "input") {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`${field} must be a string of 1 to ${maximum} characters`);
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool input must be a JSON object");
  }
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

function unknownWalletPass(dataMode: CardeaDataMode, passId: string) {
  return JSON.stringify({
    ok: false,
    dataMode,
    persisted: false,
    scope: "ui_local",
    visibleEffect: "none",
    passId,
    error: {
      code: "unknown_wallet_pass",
      message: "That wallet pass is not one of the person's starter passes.",
    },
  });
}

/**
 * Backoff before retrying a refused registration. The board remounts per
 * workspace, so a `registerTool` can land while the previous mount's tool of
 * the same name is still being torn down; nothing in the API guarantees the
 * abort has been processed by then. Retrying on a later task lets it settle.
 * Running out of entries gives up and warns.
 */
const REGISTER_RETRY_MS = [0, 60, 250];

/** Bounded poll for a `document.modelContext` injected after hydration. */
const CONTEXT_POLL_MS = 200;
const CONTEXT_WAIT_LIMIT_MS = 4_000;

/**
 * Resolves the WebMCP entry point, waiting for it when it is not there yet.
 *
 * A browser can inject `document.modelContext` after this page hydrates: a
 * flag flipped, an extension loading late. Registering once at mount and never
 * again would leave that session with no tools at all. The wait is bounded, so
 * a browser that will never have the API stops polling rather than ticking for
 * the life of the tab.
 */
function whenModelContext(signal: AbortSignal): Promise<CardeaModelContext | null> {
  if (document.modelContext) return Promise.resolve(document.modelContext);
  return new Promise((resolve) => {
    let waited = 0;
    const tick = () => {
      if (signal.aborted) return resolve(null);
      if (document.modelContext) return resolve(document.modelContext);
      waited += CONTEXT_POLL_MS;
      if (waited >= CONTEXT_WAIT_LIMIT_MS) return resolve(null);
      setTimeout(tick, CONTEXT_POLL_MS);
    };
    setTimeout(tick, CONTEXT_POLL_MS);
  });
}

export function useCardeaWebMCP(actions: CardeaWebMCPActions) {
  const latest = useRef(actions);

  useEffect(() => {
    latest.current = actions;
  }, [actions]);

  useEffect(() => {
    const controller = new AbortController();
    // Resolved once and shared by every registration below, so a late-arriving
    // API is waited for exactly once rather than per tool.
    const ready = whenModelContext(controller.signal);
    // Every tool failure reaches the calling agent as the same structured
    // envelope its successes use. Chrome does not document how a thrown
    // execute() surfaces to the model, so nothing here may rely on exception
    // propagation: validation throws from `text`/`object` are converted into
    // a parseable refusal naming what was wrong.
    const register = (tool: CardeaWebMCPTool) => {
      const declared: CardeaWebMCPTool = {
        ...tool,
        async execute(input, options) {
          try {
            return await tool.execute(input, options);
          } catch (error) {
            return JSON.stringify({
              ok: false,
              dataMode: latest.current.dataMode,
              persisted: false,
              visibleEffect: "none",
              error: {
                code: "invalid_input",
                message: error instanceof Error ? error.message : "invalid tool input",
              },
            });
          }
        },
      };
      const attempt = (index: number): Promise<void> =>
        ready.then((context) => {
          // An aborted controller means this mount has already been replaced;
          // its registrations must not race the ones that replaced them.
          if (!context || controller.signal.aborted) return;
          return context.registerTool(declared, { signal: controller.signal }).catch((error) => {
            if (controller.signal.aborted) return;
            const delay = REGISTER_RETRY_MS[index];
            if (delay === undefined) {
              // A silently missing tool is the worst demo failure mode; say why.
              console.warn(`[webmcp] failed to register ${tool.name}`, error);
              return;
            }
            return new Promise<void>((resolve) => {
              setTimeout(() => resolve(attempt(index + 1)), delay);
            });
          });
        });
      return attempt(0);
    };

    void Promise.all([
      register({
        name: "create_mission",
        description: "Create a draft Cardea mission from a user goal and open its visible mandate for review.",
        inputSchema: objectSchema({ goal: { type: "string", minLength: 1, maxLength: 8000 } }, ["goal"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const goal = text(object(input).goal, 8_000, "goal");
          return toolResult(await latest.current.createMission(goal, { signal: options?.signal }));
        },
      }),
      register({
        name: "inspect_canvas",
        description:
          "Read a bounded summary of the visible Cardea mission, nodes, states, and pending decisions. When approvalsReadable is true, each pending approval comes back with its question, its options, and its consequence, which you should relay to the person in their own words so they can choose. When it is false, this surface cannot read approval content and only the count is trustworthy.",
        inputSchema: objectSchema({}),
        annotations: { readOnlyHint: true },
        execute() {
          const current = latest.current;
          return JSON.stringify({
            ok: true,
            dataMode: current.dataMode,
            persisted: current.spine.persisted,
            stage: current.stage,
            selectedNodeId: current.selectedNodeId,
            // Bounded; nodeCount says how many exist so truncation is visible.
            nodes: current.nodes.slice(0, 20),
            nodeCount: current.nodes.length,
            mission: {
              id: current.spine.missionId,
              status: current.spine.missionStatus,
              mandateVersion: current.spine.mandateVersion,
              stateVersion: current.spine.stateVersion,
              latestSequence: current.spine.latestSequence,
            },
            pendingApprovals: current.spine.pendingApprovalIds.length,
            // A surface that cannot read approval content says so explicitly,
            // rather than an empty list reading as "nothing pending" while
            // pendingApprovals counts nonzero.
            approvals: current.approvals ?? [],
            approvalsReadable: current.approvals !== undefined,
            wallet: current.wallet ?? [],
            walletAvailable: current.wallet !== undefined,
          });
        },
      }),
      register({
        name: "update_mandate",
        description: "Propose a bounded change to the visible Cardea mandate for the user to review.",
        inputSchema: objectSchema({ instruction: { type: "string", minLength: 1, maxLength: 4000 } }, ["instruction"]),
        annotations: { readOnlyHint: false },
        async execute(input, options) {
          const instruction = text(object(input).instruction, 4_000, "instruction");
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
          const nodeId = text(object(input).nodeId, 120, "nodeId");
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
          const nodeId = text(value.nodeId, 120, "nodeId");
          const instruction = text(value.instruction, 4_000, "instruction");
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
          const nodeId = text(value.nodeId, 120, "nodeId");
          const action = String(value.action);
          if (!["pause", "resume", "retry", "revert"].includes(action)) {
            throw new Error("action must be one of pause, resume, retry, revert");
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
          if (!["accept", "modify", "reject"].includes(decision)) {
            throw new Error("decision must be one of accept, modify, reject");
          }
          // Omitted means "whatever approval is visible"; supplied is validated.
          const approvalId =
            value.approvalId === undefined ? undefined : text(value.approvalId, 120, "approvalId");
          // Bounded here too: the schema's maxLength is advisory to the model,
          // never enforced by the browser.
          const note =
            typeof value.note === "string" ? value.note.slice(0, 2_000) : undefined;
          return toolResult(
            await latest.current.resolveApproval(
              decision as ApprovalDecision,
              note,
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
          const nodeId = text(object(input).nodeId, 120, "nodeId");
          const current = latest.current;
          if (!current.openTakeover(nodeId)) return unknownNode(current.dataMode, nodeId);
          return uiResult(current.dataMode, "takeover_opened", { nodeId, liveBrowser: false });
        },
      }),
      register({
        name: "toggle_wallet_pass",
        description:
          "Select or deselect one of the person's context wallet passes, listed under wallet in inspect_canvas. Only affects a mission not yet created: once a mission's mandate is opened its wallet selection is fixed and this tool cannot change it. Safe to call without asking first, since it only chooses among the person's own pre-existing passes and grants no new authority.",
        inputSchema: objectSchema({ id: { type: "string", minLength: 1, maxLength: 120 } }, ["id"]),
        annotations: { readOnlyHint: false },
        execute(input) {
          const id = text(object(input).id, 120, "id");
          const current = latest.current;
          // A surface with no wallet mounted refuses with its own code, so a
          // real pass id is never misreported as unknown.
          if (!current.toggleWalletPass) {
            return JSON.stringify({
              ok: false,
              dataMode: current.dataMode,
              persisted: false,
              scope: "ui_local",
              visibleEffect: "none",
              error: {
                code: "wallet_unavailable",
                message: "This surface has no context wallet to toggle.",
              },
            });
          }
          if (!current.toggleWalletPass(id)) return unknownWalletPass(current.dataMode, id);
          return uiResult(current.dataMode, "wallet_pass_toggled", { passId: id });
        },
      }),
    ]);

    // Registered only where the canvas actually has live browser tiles, per
    // the capability it uses, not per the workspace strip.
    if (latest.current.openPages) {
      void register({
        name: "open_pages",
        description:
          "Open up to 3 public https pages as live browser tiles on the visible Cardea canvas, placed beside the mission so the person can watch them. Each page spends one of the person's metered live-browser sessions, so open only pages they asked to see or that the mission's evidence names.",
        inputSchema: objectSchema(
          {
            urls: {
              type: "array",
              minItems: 1,
              maxItems: MAX_OPEN_PAGES,
              items: { type: "string", maxLength: 2_000 },
            },
          },
          ["urls"],
        ),
        annotations: { readOnlyHint: false },
        execute(input) {
          const urls = sanitizePageUrls(object(input).urls);
          const openPages = latest.current.openPages;
          if (!openPages || urls.length === 0) return openPagesResult([]);
          return openPagesResult(openPages(urls));
        },
      });
    }

    // The workspace strip only exists on `/app`. A board mounted without one
    // must not advertise a switch it has no way to perform, so these two are
    // registered against the actions present at registration time rather than
    // being declared unconditionally and failing when called.
    if (latest.current.listMissions) {
      void Promise.all([
        register({
          name: "list_missions",
          description:
            "List this person's recent Cardea missions as workspaces, newest first, so one can be opened with open_mission.",
          inputSchema: objectSchema({}),
          annotations: { readOnlyHint: true },
          async execute() {
            const missions = (await latest.current.listMissions?.()) ?? [];
            return JSON.stringify({ ok: true, missions });
          },
        }),
        register({
          name: "open_mission",
          description:
            "Switch the visible Cardea workspace to one of the person's existing missions by id from list_missions. Interface only: it changes what is on screen and never changes mission state.",
          inputSchema: objectSchema(
            { missionId: { type: "string", minLength: 1, maxLength: 40 } },
            ["missionId"],
          ),
          annotations: { readOnlyHint: false },
          execute(input) {
            const missionId = text(object(input).missionId, 40, "missionId");
            return workspaceSwitchResult(
              missionId,
              latest.current.openMission?.(missionId) ?? false,
            );
          },
        }),
      ]);
    }

    return () => controller.abort();
  }, []);
}
