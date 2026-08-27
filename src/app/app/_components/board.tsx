"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { ActivityRail } from "./activity-rail";
import { Launcher, type LauncherPhase } from "./launcher";
import { MandateSheet } from "./mandate-sheet";
import { MissionLayer, type MissionNodeView } from "./mission-layer";
import type { NodeCardStatus } from "./node-card";
import { TakeoverPanel } from "./takeover-panel";
import { type BoardMissionControls, useAppWebmcp } from "./use-app-webmcp";
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

  const live = useLiveMission();
  const { snapshot, stage, events, dataSource, dataMode } = live;

  const [busy, setBusy] = useState<null | "create" | "approve">(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [takeoverNodeId, setTakeoverNodeId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [freePassage, setFreePassage] = useState(false);
  const [mention, setMention] = useState<{ codename: string | null; nonce: number } | null>(null);
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

  const plan = useMemo(() => planArtifact(events), [events]);

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
    for (const node of snapshot.nodes) {
      views.set(node.id, {
        status: toCardStatus(node.status),
        surface: deriveWorkSurface(
          node.requiredCapabilities.map((c) => c.name),
          COMPANION_ORIGIN,
        ),
        lastEventAt: times.get(node.id) ?? null,
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
        const result = await dataSource.createMission({ goal, freePassage });
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
    [animateTo, dataMode.persistenceAvailable, dataSource, freePassage, viewRef],
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

  // --- Takeover: the companion work surface ------------------------------
  const recordEvidence = useCompanionEvidenceRecorder({
    dataMode: dataMode.persistenceAvailable ? "live" : "fixture",
    missionId: snapshot?.mission.id ?? null,
  });
  const companion = useCompanionTools({
    origin: takeoverNodeId ? COMPANION_ORIGIN : null,
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
        <Link className={styles.signIn} href="/signin?next=/app" aria-label="Sign in to Cardea" title="Sign in">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12 6.5V5a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 4 5v10a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 15v-1.5M8.5 10h8m0 0-2.5-2.5M16.5 10 14 12.5" />
          </svg>
        </Link>
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

      <Launcher phase={launcherPhase} error={error} mention={mention} onSubmit={submit} onStop={stop} />

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
          companion={companion}
          onClose={() => setTakeoverNodeId(null)}
        />
      )}
    </div>
  );
}
