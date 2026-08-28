"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type BoardLayout, layoutMissionPlan } from "@/core/board/plan-layout";
import {
  MAJOR_EVERY,
  MAX_SCALE,
  MIN_SCALE,
  gridStepFor,
  screenToWorld,
  worldToScreen,
} from "@/core/board/viewport";
import type { MissionSnapshot } from "@/core/contracts/types";
import { deriveWorkSurface } from "@/core/contracts/work-surface";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { useCompanionEvidenceRecorder } from "@/webmcp/use-companion-evidence-recorder";
import { useCompanionTools } from "@/webmcp/use-companion-tools";
import { useLiveMission } from "../_data/use-live-mission";
import { AccountModal } from "./account-modal";
import { DebriefCard } from "./debrief-card";
import { ActivityRail } from "./activity-rail";
import { BudgetFlag } from "./budget-flag";
import { deriveBudgetFlag } from "./derive-budget-flag";
import { IntegrationsModal } from "./integrations-modal";
import { StandingMissionsModal } from "./standing-missions-modal";
import { Launcher, type LauncherPhase } from "./launcher";
import { MandateSheet } from "./mandate-sheet";
import { MissionLayer, type MissionNodeView } from "./mission-layer";
import { RemoteBrowserNode } from "./remote-browser-node";
import type { NodeCardStatus } from "./node-card";
import { TakeoverPanel } from "./takeover-panel";
import { type BoardMissionControls, useAppWebmcp } from "./use-app-webmcp";
import { useWallet } from "./wallet/use-wallet";
import { WalletStack } from "./wallet/wallet-stack";
import { WalletSurface } from "./wallet/wallet-surface";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBoardView } from "./use-board-view";
import styles from "./board.module.css";

const RULER = 22;
/** Chrome that overlaps the board: the ruler above, the docked composer below. */
const COMPOSER_INSETS = { top: RULER, bottom: 150 };

const COMPANION_ORIGIN = process.env.NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN ?? null;

/**
 * The live path has no cancelled card treatment because the state is
 * unreachable today; if it ever arrives it reads as failed rather than
 * inventing a softer label.
 */
function toCardStatus(status: string): NodeCardStatus {
  return status === "cancelled" ? "failed" : (status as NodeCardStatus);
}

/** Newest recorded work summary per node, so cards show real output. */
function latestNodeSummaries(
  events: readonly { type: string; nodeId?: string | null; payload: unknown }[],
) {
  const summaries = new Map<string, string>();
  for (const event of events) {
    if (!event.nodeId) continue;
    if (event.type !== "evidence.recorded" && event.type !== "tool.completed") continue;
    const payload = event.payload as Record<string, unknown> | null;
    if (typeof payload?.summary === "string" && payload.summary.trim()) {
      summaries.set(event.nodeId, payload.summary.trim());
    }
  }
  return summaries;
}

/** Latest per-node activity timestamps from the event ring buffer. */
function lastEventTimes(events: readonly { nodeId?: string | null; createdAt: string }[]) {
  const out = new Map<string, string>();
  for (const event of events) {
    if (event.nodeId) out.set(event.nodeId, event.createdAt);
  }
  return out;
}

/** The plan artifact travels on mandate.proposed with a flat payload. */
function planArtifact(events: readonly { type: string; payload: unknown }[]) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type !== "mandate.proposed") continue;
    const payload = events[i].payload as Record<string, unknown> | null;
    if (!payload) return null;
    const title = typeof payload.title === "string" ? payload.title : null;
    const summary = typeof payload.summary === "string" ? payload.summary : null;
    const boundaries = Array.isArray(payload.approvalBoundaries)
      ? payload.approvalBoundaries.filter((b): b is string => typeof b === "string")
      : [];
    if (title && summary) return { title, summary, approvalBoundaries: boundaries };
    return null;
  }
  return null;
}

/** Board geometry from a live snapshot: nodes plus depends_on edges. */
function layoutFromSnapshot(
  snapshot: MissionSnapshot,
  summary: string,
): BoardLayout | null {
  if (snapshot.nodes.length === 0) return null;
  const dependsOn = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    if (edge.kind !== "depends_on") continue;
    const list = dependsOn.get(edge.toNodeId) ?? [];
    list.push(edge.fromNodeId);
    dependsOn.set(edge.toNodeId, list);
  }
  return layoutMissionPlan({
    title: snapshot.mission.title,
    summary,
    nodes: snapshot.nodes.map((node) => ({
      clientId: node.id,
      codename: node.codename,
      roleLabel: node.roleLabel,
      objective: node.objective,
      capabilityNames: node.requiredCapabilities.map((c) => c.name),
      dependsOn: dependsOn.get(node.id) ?? [],
    })),
    approvalBoundaries: [],
  });
}

async function requestPreviewPlan(goal: string, signal: AbortSignal) {
  const response = await fetch("/api/board/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal }),
    signal,
  });
  if (!response.ok) {
    throw new Error("Cardea could not draw up a plan for that. Try rephrasing the goal.");
  }
  const payload = (await response.json()) as { layout: BoardLayout };
  return payload.layout;
}

export function CardeaBoard() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const {
    view,
    viewRef,
    animateTo,
    isPanning,
    spaceHeld,
    zoomBy,
    focusOn,
    resetView,
    beginPan,
    movePan,
    endPan,
  } = useBoardView(surfaceRef);

  const router = useRouter();
  const live = useLiveMission();
  const { snapshot, stage, events, dataSource, dataMode } = live;

  const [busy, setBusy] = useState<null | "create" | "approve">(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [takeoverNodeId, setTakeoverNodeId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  // Live remote-browser surfaces the person opened, in world space. Session
  // scoped: a refresh drops them, matching the remote sessions themselves.
  const [browserTabs, setBrowserTabs] = useState<
    { id: string; url: string; x: number; y: number }[]
  >([]);
  const [browserPrompt, setBrowserPrompt] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  // Returning from a Composio OAuth hop lands back on the board with an
  // `integrations` marker; reopen the modal the person connected from and
  // clean the address bar. Deferred a tick to keep setState out of the
  // effect body itself (repo lint rule).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // `integrations` marks the managed connect hop; `integration` (singular)
    // is the mission-scoped authorize callback. Both reopen the modal.
    if (!params.has("integrations") && !params.has("integration")) return;
    const timer = setTimeout(() => {
      setIntegrationsOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const [standingOpen, setStandingOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [holderName, setHolderName] = useState<string | null>(null);
  const wallet = useWallet();
  const [browserUrl, setBrowserUrl] = useState("");
  const [freePassage, setFreePassage] = useState(false);
  const [mention, setMention] = useState<{ codename: string | null; nonce: number } | null>(null);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [followUp, setFollowUp] = useState<{ missionId: string; title: string } | null>(null);
  const followUpShownRef = useRef<string | null>(null);
  // A dismissed or pivoted budget stop stays quiet for that node; a later
  // stop on a different node raises the flag again.
  const [budgetFlagHiddenFor, setBudgetFlagHiddenFor] = useState<string | null>(null);
  const [previewLayout, setPreviewLayout] = useState<BoardLayout | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The board has no anonymous state: whoever has not chosen a way in yet
  // does that on the sign-in page itself, which carries all four doors.
  useEffect(() => {
    if (live.session.status === "anonymous") {
      router.replace("/signin?next=/app");
    }
  }, [live.session.status, router]);

  // The pass holder is the signed-in person, by their real name when Google
  // provided one, else the email; guests hold an unnamed guest pass.
  useEffect(() => {
    let cancelled = false;
    const resolve = async (): Promise<string | null> => {
      if (live.session.status !== "authenticated") return null;
      const { data } = await createSupabaseBrowserClient().auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      return (
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        data.user?.email ||
        null
      );
    };
    resolve()
      .then((name) => {
        if (!cancelled) setHolderName(name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live.session.status]);

  const plan = useMemo(() => planArtifact(events), [events]);

  const budgetFlag = useMemo(
    () => deriveBudgetFlag(events, snapshot?.nodes ?? []),
    [events, snapshot],
  );

  // The end result: on completion, the terminal node's recorded deliverable
  // becomes the mission brief. Terminal means no other node depends on it;
  // the text is the node's own newest recorded finding, verbatim.
  const debrief = useMemo(() => {
    if (!snapshot) return null;
    // The brief appears once Cardea has done everything it can on its own:
    // nothing is running, and every node still marked planned is blocked
    // behind a dependency that has not completed (so nothing more will
    // start without the person). Mission status itself never advances past
    // draft today, so the graph is the only honest signal.
    const dependsOn = new Map<string, string[]>();
    for (const edge of snapshot.edges) {
      if (edge.kind !== "depends_on") continue;
      const list = dependsOn.get(edge.toNodeId) ?? [];
      list.push(edge.fromNodeId);
      dependsOn.set(edge.toNodeId, list);
    }
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const blocked = (nodeId: string) =>
      (dependsOn.get(nodeId) ?? []).some((dep) => byId.get(dep)?.status !== "completed");
    const settled =
      stage === "complete" ||
      (snapshot.nodes.length > 0 &&
        snapshot.nodes.every((n) => n.status !== "running") &&
        snapshot.nodes.some((n) => n.status === "completed") &&
        snapshot.nodes.every((n) => n.status !== "planned" || blocked(n.id)));
    if (!settled) return null;
    // Prefer the terminal deliverable; otherwise the newest completed node
    // that actually recorded one. Text is verbatim from the node's finding.
    const prerequisiteIds = new Set(
      snapshot.edges.filter((e) => e.kind === "depends_on").map((e) => e.fromNodeId),
    );
    const findings = new Map<string, string>();
    for (const event of events) {
      if (!event.nodeId || event.type !== "tool.completed") continue;
      const payload = event.payload as Record<string, unknown> | null;
      const output = payload?.output as Record<string, unknown> | undefined;
      if (output && typeof output.finding === "string" && output.finding.trim()) {
        findings.set(event.nodeId, output.finding.trim());
      }
    }
    const completed = snapshot.nodes.filter((n) => n.status === "completed" && findings.has(n.id));
    if (completed.length === 0) return null;
    const source =
      completed.filter((n) => !prerequisiteIds.has(n.id)).at(-1) ?? completed.at(-1);
    if (!source) return null;
    return {
      missionId: snapshot.mission.id,
      title: snapshot.mission.title,
      codename: source.codename,
      text: findings.get(source.id) as string,
    };
  }, [events, snapshot, stage]);
  const [debriefHiddenFor, setDebriefHiddenFor] = useState<string | null>(null);

  // The proactive beat: when a mission completes, Cardea proposes the next
  // one. Always a proposal in the composer, never an action: the person
  // edits and sends it, or dismisses it and nothing happens.
  useEffect(() => {
    if (!snapshot || stage !== "complete") return;
    if (followUpShownRef.current === snapshot.mission.id) return;
    followUpShownRef.current = snapshot.mission.id;
    setFollowUp({ missionId: snapshot.mission.id, title: snapshot.mission.title });
  }, [snapshot, stage]);

  const layout = useMemo(() => {
    if (snapshot) {
      return layoutFromSnapshot(snapshot, plan?.summary ?? snapshot.mandate.goal);
    }
    return previewLayout;
  }, [plan?.summary, previewLayout, snapshot]);

  const preview = !snapshot && previewLayout !== null;

  const nodeViews = useMemo(() => {
    const views = new Map<string, MissionNodeView>();
    if (!snapshot) return views;
    const times = lastEventTimes(events);
    const summaries = latestNodeSummaries(events);
    // A paused node must say why in place: connection_required carries the
    // toolkit whose account is missing.
    const pauseNotes = new Map<string, string>();
    for (const event of events) {
      if (!event.nodeId) continue;
      if (event.type === "node.paused") {
        const payload = event.payload as Record<string, unknown> | null;
        if (payload?.reason === "connection_required") {
          const toolkit = payload.toolkit === "googlecalendar" ? "Google Calendar" : payload.toolkit === "gmail" ? "Gmail" : "the service";
          pauseNotes.set(event.nodeId, `Waiting on a ${toolkit} connection. Open Connected services to continue.`);
        } else {
          pauseNotes.set(event.nodeId, "Paused. Open the node for its record.");
        }
      } else if (event.type === "node.resumed" || event.type === "node.started") {
        pauseNotes.delete(event.nodeId);
      }
    }
    for (const node of snapshot.nodes) {
      views.set(node.id, {
        status: toCardStatus(node.status),
        surface: deriveWorkSurface(
          node.requiredCapabilities.map((c) => c.name),
          COMPANION_ORIGIN,
        ),
        lastEventAt: times.get(node.id) ?? null,
        latestSummary: summaries.get(node.id) ?? null,
        pausedNote:
          node.status === "paused" || node.status === "waiting"
            ? pauseNotes.get(node.id) ?? null
            : null,
      });
    }
    return views;
  }, [events, snapshot]);

  const mandateOpen =
    snapshot !== null && !snapshot.mandate.approvedAt && stage === "awaiting_mandate";

  const working = busy === "create" || stage === "planning";

  const submit = useCallback(
    async (goal: string) => {
      setError(null);
      setBusy("create");
      // The sheet opens out before the mission lands, so the wait reads as
      // room being made rather than as nothing happening.
      const here = viewRef.current;
      animateTo({ x: here.x, y: here.y + 40, scale: 0.86 }, 700);

      if (dataMode.persistenceAvailable) {
        const result = await dataSource.createMission({
          goal,
          freePassage,
          selectedContextCardIds: wallet.selectedIds,
          budgetMicrounits: Math.round(wallet.totalLoadedUsd * 1_000_000),
        });
        setBusy(null);
        if (!result.ok) {
          setError(result.failure?.message ?? "Cardea could not open the mission.");
          animateTo({ ...viewRef.current, scale: 1 }, 460);
        }
        return;
      }

      // Persistence is unavailable (no session backend); fall back to the
      // planner preview so the surface never dead-ends, and say what it is.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const next = await requestPreviewPlan(goal, controller.signal);
        if (!controller.signal.aborted) setPreviewLayout(next);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Something went wrong.");
          animateTo({ ...viewRef.current, scale: 1 }, 460);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(null);
      }
    },
    [animateTo, dataMode.persistenceAvailable, dataSource, freePassage, viewRef, wallet.selectedIds, wallet.totalLoadedUsd],
  );

  const approveMandate = useCallback(async () => {
    setBusy("approve");
    setError(null);
    const result = await dataSource.approveMandate();
    setBusy(null);
    if (!result.ok) {
      setError(result.failure?.message ?? "Cardea could not approve the mandate.");
    }
  }, [dataSource]);

  const resolveApproval = useCallback(
    async (approvalId: string, decision: "accept" | "modify" | "reject", note?: string) => {
      setResolvingApprovalId(approvalId);
      setError(null);
      const result = await dataSource.resolveApproval({ decision, note });
      setResolvingApprovalId(null);
      if (!result.ok) {
        setError(result.failure?.message ?? "That approval could not be settled.");
      }
    },
    [dataSource],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
  }, []);

  // Frame the mission once geometry exists and the surface has been measured.
  const framedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!layout || size.width === 0) return;
    const key = `${layout.nodes.length}:${preview}`;
    if (framedForRef.current === key) return;
    framedForRef.current = key;
    focusOn(layout.bounds, 110, true, COMPOSER_INSETS);
  }, [focusOn, layout, preview, size.width]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPreviewLayout(null);
    setError(null);
    setSelectedNodeId(null);
    setTakeoverNodeId(null);
    resetView();
  }, [resetView]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea")) {
        if (event.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomBy(1.25);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / 1.25);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetView, zoomBy]);

  // --- Takeover: the node's own work surface -----------------------------
  // The companion store only opens for a node whose capabilities actually
  // work the companion; every other node opens to its recorded work.
  const takeoverMissionNode = takeoverNodeId
    ? snapshot?.nodes.find((n) => n.id === takeoverNodeId) ?? null
    : null;
  const takeoverIsCompanion =
    takeoverMissionNode?.requiredCapabilities.some((c) => c.name.includes("companion.")) ?? false;
  const takeoverWork = useMemo(() => {
    if (!takeoverNodeId) return [];
    const rows: {
      id: string;
      kind: string;
      title: string;
      detail: string | null;
      trust: string;
      at: string;
    }[] = [];
    for (const event of events) {
      if (event.nodeId !== takeoverNodeId) continue;
      if (
        event.type !== "evidence.recorded" &&
        event.type !== "tool.completed" &&
        event.type !== "tool.failed"
      ) {
        continue;
      }
      const payload = event.payload as Record<string, unknown> | null;
      const capability =
        typeof payload?.capabilityId === "string"
          ? payload.capabilityId
          : typeof payload?.capabilityName === "string"
            ? payload.capabilityName
            : event.type;
      const detail =
        typeof payload?.summary === "string"
          ? payload.summary
          : typeof payload?.reason === "string"
            ? payload.reason
            : null;
      rows.push({
        id: String(event.sequence),
        kind: event.type,
        title: capability,
        detail,
        trust: event.trust,
        at: event.createdAt,
      });
    }
    return rows.slice(-12).reverse();
  }, [events, takeoverNodeId]);

  // The page a web-lookup node actually read, so the takeover can open a
  // real interactive browser on that exact address.
  const takeoverBrowsedUrl = useMemo(() => {
    if (!takeoverNodeId) return null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.nodeId !== takeoverNodeId || event.type !== "tool.completed") continue;
      const payload = event.payload as Record<string, unknown> | null;
      const output = payload?.output as Record<string, unknown> | undefined;
      if (payload?.capabilityId === "cardea.web_lookup") {
        const url = output?.finalUrl ?? output?.url;
        if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
      }
      if (payload?.capabilityId === "cardea.web_research" && Array.isArray(output?.results)) {
        // The first result the research step actually read; unreadable
        // entries carry an error instead of a title and are skipped.
        for (const entry of output.results as Record<string, unknown>[]) {
          if (typeof entry?.url === "string" && !entry.error && /^https?:\/\//.test(entry.url)) {
            return entry.url;
          }
        }
      }
    }
    return null;
  }, [events, takeoverNodeId]);

  const recordEvidence = useCompanionEvidenceRecorder({
    dataMode: dataMode.persistenceAvailable ? "live" : "fixture",
    missionId: snapshot?.mission.id ?? null,
  });
  const companion = useCompanionTools({
    origin: takeoverNodeId && takeoverIsCompanion ? COMPANION_ORIGIN : null,
    recordEvidence,
    fixtureReason: "No live mission is open, so companion evidence is shown but not persisted.",
  });

  const focusNode = useCallback(
    (nodeId: string): boolean => {
      const node = layout?.nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      setSelectedNodeId(nodeId);
      focusOn({ x: node.x, y: node.y, width: node.width, height: node.height }, 180, true, COMPOSER_INSETS);
      return true;
    },
    [focusOn, layout],
  );

  const openTakeover = useCallback(
    (nodeId: string): boolean => {
      const node = layout?.nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      setSelectedNodeId(nodeId);
      setTakeoverNodeId(nodeId);
      return true;
    },
    [layout],
  );

  const controls: BoardMissionControls = useMemo(
    () => ({
      selectedNodeId,
      focusNode,
      openTakeover,
      openComposer: (codename) =>
        setMention((current) => ({ codename, nonce: (current?.nonce ?? 0) + 1 })),
    }),
    [focusNode, openTakeover, selectedNodeId],
  );

  useAppWebmcp({ handle: live, controls });

  // --- Grid + rulers (unchanged board material) ---------------------------
  const step = gridStepFor(view.scale);
  const minorPx = step * view.scale;
  const majorPx = minorPx * MAJOR_EVERY;
  const minorAlpha = Math.min(1, Math.max(0, (minorPx - 4.5) / 8));

  const gridVars = {
    "--minor": `${minorPx}px`,
    "--major": `${majorPx}px`,
    "--ox": `${view.x}px`,
    "--oy": `${view.y}px`,
    "--minor-alpha": `${minorAlpha}`,
  } as React.CSSProperties;

  const ticks = useMemo(() => {
    if (size.width === 0) return { horizontal: [], vertical: [] };
    const spacing = step * MAJOR_EVERY;
    const build = (extent: number, axis: "x" | "y") => {
      const from = screenToWorld(view, 0, 0)[axis];
      const to = screenToWorld(view, axis === "x" ? extent : 0, axis === "x" ? 0 : extent)[axis];
      const first = Math.ceil(from / spacing) * spacing;
      const out: { value: number; offset: number }[] = [];
      for (let value = first; value <= to && out.length < 200; value += spacing) {
        const point = worldToScreen(view, value, value);
        out.push({ value, offset: axis === "x" ? point.x : point.y });
      }
      return out;
    };
    return { horizontal: build(size.width, "x"), vertical: build(size.height, "y") };
  }, [size.height, size.width, step, view]);

  const origin = worldToScreen(view, 0, 0);

  function onSurfacePointerDown(event: React.PointerEvent) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).dataset.board) return;
    if (event.button === 1 || event.button === 0) beginPan(event);
  }

  function onSurfacePointerMove(event: React.PointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorWorld(screenToWorld(view, event.clientX - rect.left, event.clientY - rect.top));
    }
    movePan(event);
  }

  const launcherPhase: LauncherPhase =
    !snapshot && !previewLayout && busy !== "create" ? "resting" : working ? "working" : "docked";

  const openBrowserTabAt = useCallback(
    (url: string) => {
      const here = viewRef.current;
      const el = surfaceRef.current;
      const rect = el?.getBoundingClientRect();
      const centre = rect
        ? screenToWorld(here, rect.width / 2, rect.height / 2)
        : { x: 0, y: 0 };
      setBrowserTabs((tabs) => [
        ...tabs,
        {
          id: `rb_${Date.now().toString(36)}`,
          url,
          x: centre.x - 290 + tabs.length * 42,
          y: centre.y - 200 + tabs.length * 42,
        },
      ]);
    },
    [viewRef],
  );

  const openBrowserTab = useCallback(() => {
    const raw = browserUrl.trim();
    let target: URL;
    try {
      target = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
      setError("Enter a full website address, like example.com.");
      return;
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      setError("Only http and https addresses can be opened.");
      return;
    }
    const here = viewRef.current;
    const el = surfaceRef.current;
    const rect = el?.getBoundingClientRect();
    const centre = rect
      ? screenToWorld(here, rect.width / 2, rect.height / 2)
      : { x: 0, y: 0 };
    setBrowserTabs((tabs) => [
      ...tabs,
      {
        id: `rb_${Date.now().toString(36)}`,
        url: target.toString(),
        x: centre.x - 290 + tabs.length * 42,
        y: centre.y - 200 + tabs.length * 42,
      },
    ]);
    setBrowserPrompt(false);
    setBrowserUrl("");
    setError(null);
  }, [browserUrl, viewRef]);

  const nodeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const node of snapshot?.nodes ?? []) names.set(node.id, node.codename);
    return names;
  }, [snapshot]);

  const takeoverNode = takeoverNodeId
    ? layout?.nodes.find((n) => n.id === takeoverNodeId) ?? null
    : null;

  return (
    <div className={styles.root}>
      <div
        ref={surfaceRef}
        data-board="surface"
        className={styles.surface}
        data-panning={isPanning || undefined}
        data-grabbable={spaceHeld || undefined}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        role="application"
        aria-label="Cardea board. Drag to pan, pinch or cmd-scroll to zoom."
      >
        <div className={styles.paperGrid} style={gridVars} aria-hidden="true" />
        <div className={styles.constellationGrid} style={gridVars} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />

        {/* World layer: one transform carries every object on the board. */}
        <div
          className={styles.world}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {!layout && (
            <svg className={styles.origin} viewBox="0 0 80 80" aria-hidden="true" width={80} height={80}>
              <circle cx="40" cy="40" r="15" />
              <circle cx="40" cy="40" r="2.4" className={styles.originDot} />
              <path d="M40 6v20M40 54v20M6 40h20M54 40h20" />
            </svg>
          )}
          {browserTabs.map((tab) => (
            <div
              key={tab.id}
              className={styles.browserSlot}
              style={{ transform: `translate(${tab.x}px, ${tab.y}px)` }}
            >
              <RemoteBrowserNode url={tab.url} nodeId={tab.id} title={new URL(tab.url).hostname} />
              <button
                type="button"
                className={styles.browserClose}
                aria-label="Close this remote browser"
                onClick={() => {
                  setBrowserTabs((tabs) => tabs.filter((t) => t.id !== tab.id));
                  void fetch("/api/browser/stop", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ nodeId: tab.id }),
                  }).catch(() => undefined);
                }}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
              </button>
            </div>
          ))}
          {!layout && stage === "planning" && (
            <div className={styles.planSkeleton} aria-hidden="true">
              <span className={styles.skelMission} style={{ left: -420, top: 10 }} />
              <span className={styles.skelMission} style={{ left: -460, top: 40, width: 180 }} />
              {[
                { left: 60, top: -240 },
                { left: 100, top: -40 },
                { left: 60, top: 160 },
              ].map((position) => (
                <div key={`${position.left}:${position.top}`} className={styles.skelCard} style={position}>
                  <span className={styles.skelTabTitle} />
                  <span className={styles.skelChrome}>
                    <i /><i /><i />
                  </span>
                  <span className={styles.skelLine} />
                  <span className={styles.skelLine} style={{ width: "82%" }} />
                  <span className={styles.skelLine} style={{ width: "64%" }} />
                </div>
              ))}
            </div>
          )}
          {layout && (
            <MissionLayer
              layout={layout}
              views={nodeViews}
              approvals={snapshot?.pendingApprovals ?? []}
              resolvingApprovalId={resolvingApprovalId}
              selectedNodeId={selectedNodeId}
              preview={preview}
              onSelectNode={focusNode}
              onOpenTakeover={openTakeover}
              onResolveApproval={resolveApproval}
            />
          )}
        </div>

        {/* Rulers sit in screen space and read the same world units as the grid. */}
        <div className={styles.rulerCorner} aria-hidden="true">
          <span>{Math.round(view.scale * 100)}</span>
        </div>
        <div className={styles.rulerTop} aria-hidden="true">
          {ticks.horizontal.map((tick) => (
            <span key={tick.value} className={styles.tick} style={{ left: tick.offset }}>
              {tick.value}
            </span>
          ))}
          {origin.x > RULER && origin.x < size.width && (
            <i className={styles.rulerOrigin} style={{ left: origin.x }} />
          )}
        </div>
        <div className={styles.rulerLeft} aria-hidden="true">
          {ticks.vertical.map((tick) => (
            <span key={tick.value} className={styles.tick} style={{ top: tick.offset }}>
              {tick.value}
            </span>
          ))}
          {origin.y > RULER && origin.y < size.height && (
            <i className={styles.rulerOrigin} style={{ top: origin.y }} />
          )}
        </div>
      </div>

      <nav className={styles.toolbar} aria-label="Board tools">
        <button
          type="button"
          onClick={() => (layout ? focusOn(layout.bounds, 110, true, COMPOSER_INSETS) : resetView())}
          aria-label={layout ? "Frame the mission" : "Return to the origin"}
          title={layout ? "Frame the mission" : "Return to origin"}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13" />
          </svg>
        </button>
        {preview && (
          <button type="button" onClick={startOver} aria-label="Clear the preview" title="Clear preview">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16 10a6 6 0 1 1-1.9-4.4M16 4v3h-3" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => setBrowserPrompt((open) => !open)}
          aria-label="Open a live remote browser"
          aria-pressed={browserPrompt}
          title="Open a live browser"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="6.5" />
            <path d="M3.5 10h13M10 3.5c2.4 2 2.4 11 0 13-2.4-2-2.4-11 0-13Z" />
          </svg>
        </button>
        {snapshot && (
          <button
            type="button"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={railOpen ? "Close the activity rail" : "Open the activity rail"}
            aria-pressed={railOpen}
            title="Activity"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 5.5h12M4 10h12M4 14.5h7" />
            </svg>
          </button>
        )}
        <span className={styles.toolbarRule} aria-hidden="true" />
        <button
          type="button"
          onClick={() => setStandingOpen(true)}
          aria-label="Standing missions"
          title="Standing missions"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 2.5v3h-3M10 6.5V10l2.5 1.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIntegrationsOpen(true)}
          aria-label="Connected services"
          title="Connected services"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.5 12.5 5 15a2.5 2.5 0 0 1-3.5-3.5L4 9a2.5 2.5 0 0 1 3.5 0M12.5 7.5 15 5a2.5 2.5 0 0 1 3.5 3.5L16 11a2.5 2.5 0 0 1-3.5 0M8 12l4-4" />
          </svg>
        </button>
        {live.session.status === "authenticated" ? (
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="Your account"
            title="Your account"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="7" r="3.2" />
              <path d="M4 16.5c1.2-2.7 3.4-4 6-4s4.8 1.3 6 4" />
            </svg>
          </button>
        ) : (
          <Link className={styles.signIn} href="/signin?next=/app" aria-label="Sign in to Cardea" title="Sign in">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M12 6.5V5a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 4 5v10a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 15v-1.5M8.5 10h8m0 0-2.5-2.5M16.5 10 14 12.5" />
            </svg>
          </Link>
        )}
        <ThemeToggle />
      </nav>

      <div className={styles.readout}>
        <span className={styles.readoutCoord}>
          {cursorWorld ? `${Math.round(cursorWorld.x)}  ${Math.round(cursorWorld.y)}` : "·  ·"}
        </span>
        <span className={styles.readoutRule} aria-hidden="true" />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          disabled={view.scale <= MIN_SCALE + 1e-6}
          aria-label="Zoom out"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
        </button>
        <button type="button" className={styles.readoutScale} onClick={resetView} title="Reset to 100%">
          {Math.round(view.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          disabled={view.scale >= MAX_SCALE - 1e-6}
          aria-label="Zoom in"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8h8" /></svg>
        </button>
      </div>

      {browserPrompt && (
        <form
          className={styles.browserPrompt}
          onSubmit={(event) => {
            event.preventDefault();
            openBrowserTab();
          }}
        >
          <label className="sr-only" htmlFor="board-browser-url">Website to open</label>
          <input
            id="board-browser-url"
            type="text"
            placeholder="example.com"
            value={browserUrl}
            autoFocus
            spellCheck={false}
            onChange={(event) => setBrowserUrl(event.target.value)}
          />
          <button type="submit">Open</button>
        </form>
      )}

      <IntegrationsModal open={integrationsOpen} onClose={() => setIntegrationsOpen(false)} />

      <AccountModal
        open={accountOpen}
        holderName={holderName}
        authenticated={live.session.status === "authenticated"}
        onClose={() => setAccountOpen(false)}
      />

      <StandingMissionsModal
        open={standingOpen}
        defaultGoal={snapshot?.mandate.goal}
        onClose={() => setStandingOpen(false)}
      />

      <div className={styles.walletDock}>
        <WalletStack
          passes={wallet.passes.map((pass) => ({
            pass,
            amountUsd: wallet.amounts[pass.id] ?? 0,
            selected: wallet.selectedIds.includes(pass.id),
          }))}
          holderName={holderName}
          onOpen={() => setWalletOpen(true)}
        />
      </div>

      <WalletSurface
        open={walletOpen}
        holderName={holderName}
        passes={wallet.passes}
        selectedIds={wallet.selectedIds}
        amounts={wallet.amounts}
        totalLoadedUsd={wallet.totalLoadedUsd}
        onToggle={wallet.toggle}
        onLoad={wallet.load}
        onClose={() => setWalletOpen(false)}
      />

      <Launcher
        phase={launcherPhase}
        error={error}
        mention={mention}
        seed={seed}
        displayName={holderName ? (holderName.includes("@") ? holderName.split("@")[0] : holderName.split(" ")[0]) : null}
        onSubmit={submit}
        onStop={stop}
      />

      {mandateOpen && snapshot && (
        <div className={styles.sheetDock}>
          <MandateSheet
            mandate={{
              goal: snapshot.mandate.goal,
              version: snapshot.mandate.version,
              constraints: snapshot.mandate.constraints,
              approvedAt: snapshot.mandate.approvedAt,
            }}
            plan={plan}
            capabilityNames={snapshot.mandate.authority.allowedCapabilityIds}
            freePassage={freePassage}
            onFreePassageChange={setFreePassage}
            approving={busy === "approve"}
            onApprove={() => void approveMandate()}
          />
        </div>
      )}

      {budgetFlag && budgetFlag.nodeId !== budgetFlagHiddenFor && (
        <div className={styles.budgetFlagDock}>
          <BudgetFlag
            nodeCodename={budgetFlag.nodeCodename}
            attemptedUsd={budgetFlag.usedMicrounits / 1_000_000}
            loadedUsd={budgetFlag.limitMicrounits / 1_000_000}
            onOpenWallet={() => setWalletOpen(true)}
            onPivot={() => {
              const nodeId = budgetFlag.nodeId;
              setBudgetFlagHiddenFor(nodeId);
              void dataSource.redirectNode({
                nodeId,
                instruction:
                  "The step reached the loaded wallet boundary. Continue without committing any money: prepare the no-spend alternative, gather what is needed, and stop before anything that spends.",
              });
            }}
            onDismiss={() => setBudgetFlagHiddenFor(budgetFlag.nodeId)}
          />
        </div>
      )}

      {debrief && debrief.missionId !== debriefHiddenFor && (
        <DebriefCard
          missionTitle={debrief.title}
          nodeCodename={debrief.codename}
          text={debrief.text}
          onOpenUrl={openBrowserTabAt}
          onClose={() => setDebriefHiddenFor(debrief.missionId)}
        />
      )}

      {followUp && (
        <div className={styles.followUp} role="status">
          <span className={styles.followUpText}>
            The mission is complete. Want Cardea to prepare what it pointed to next?
          </span>
          <button
            type="button"
            className={styles.followUpAccept}
            onClick={() => {
              setSeed((current) => ({
                text: `Continue from the completed mission "${followUp.title}". Review what was prepared, take the next preparatory step it surfaced, and keep every earlier constraint. Commit nothing without my approval.`,
                nonce: (current?.nonce ?? 0) + 1,
              }));
              setFollowUp(null);
            }}
          >
            Draft the follow-up
          </button>
          <button
            type="button"
            className={styles.followUpDismiss}
            aria-label="Dismiss the follow-up proposal"
            onClick={() => setFollowUp(null)}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      )}

      {working && (
        <p className={styles.working} role="status">
          <i className={styles.workingMark} aria-hidden="true" />
          {busy === "create" ? "Cardea is opening the mission" : "Cardea is drawing up the plan"}
        </p>
      )}

      {dataMode.status !== "live" && dataMode.notice && (
        <p className={styles.modeNotice} role="status">
          {dataMode.notice}
        </p>
      )}

      <ActivityRail
        events={events}
        nodeNames={nodeNames}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        onFocusNode={(nodeId) => {
          focusNode(nodeId);
        }}
      />

      {takeoverNode && (
        <TakeoverPanel
          nodeCodename={takeoverNode.codename}
          companion={takeoverIsCompanion ? companion : null}
          surfaceLabel={(() => {
            const view = nodeViews.get(takeoverNode.id);
            if (!view) return "Work record";
            return view.surface.kind === "webmcp"
              ? `WebMCP · ${view.surface.label}`
              : "Capture";
          })()}
          objective={takeoverMissionNode?.objective ?? null}
          statusLabel={takeoverMissionNode?.status ?? null}
          work={takeoverWork}
          liveViewUrl={takeoverBrowsedUrl}
          nodeId={takeoverNode.id}
          onClose={() => setTakeoverNodeId(null)}
        />
      )}
    </div>
  );
}
