"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardLayout } from "@/core/board/plan-layout";
import {
  MAJOR_EVERY,
  MAX_SCALE,
  MIN_SCALE,
  gridStepFor,
  screenToWorld,
  worldToScreen,
} from "@/core/board/viewport";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { Launcher, type LauncherPhase } from "./launcher";
import { MissionLayer } from "./mission-layer";
import { useBoardView } from "./use-board-view";
import styles from "./board.module.css";

const RULER = 22;
/** Chrome that overlaps the board: the ruler above, the docked composer below. */
const COMPOSER_INSETS = { top: RULER, bottom: 150 };

type Phase = "resting" | "working" | "mission";

const PHASE_TO_LAUNCHER: Record<Phase, LauncherPhase> = {
  resting: "resting",
  working: "working",
  mission: "docked",
};

async function requestPlan(goal: string, signal: AbortSignal) {
  const send = () =>
    fetch("/api/board/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal }),
      signal,
    });

  let response = await send();

  // A first-time visitor has no session yet. Mint a guest allowance and retry
  // once, rather than showing them a sign-in wall they never asked for.
  if (response.status === 401) {
    await fetch("/api/guest/session", { method: "POST", signal });
    response = await send();
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const code = typeof detail?.error === "string" ? detail.error : null;
    if (response.status === 503 && code === "planner_unavailable") {
      throw new Error("Cardea's planner is not configured, so no plan was produced.");
    }
    if (response.status === 429) {
      throw new Error("That was a lot at once. Give it a moment and try again.");
    }
    if (response.status === 401) {
      throw new Error("Cardea could not open a session for you. Try again in a moment.");
    }
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

  const [phase, setPhase] = useState<Phase>("resting");
  const [layout, setLayout] = useState<BoardLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const submit = useCallback(
    async (goal: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setLayout(null);
      setPhase("working");

      // The sheet opens out before the plan lands, so the wait reads as room
      // being made rather than as nothing happening.
      const here = viewRef.current;
      animateTo({ x: here.x, y: here.y + 40, scale: 0.82 }, 780);

      try {
        const next = await requestPlan(goal, controller.signal);
        if (controller.signal.aborted) return;
        setLayout(next);
        setPhase("mission");
      } catch (caught) {
        if (controller.signal.aborted || (caught as Error)?.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
        setPhase("resting");
        animateTo({ ...viewRef.current, scale: 1 }, 520);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [animateTo, viewRef],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("resting");
    animateTo({ ...viewRef.current, scale: 1 }, 460);
  }, [animateTo, viewRef]);

  // Frame the plan once it exists and the surface has been measured. The
  // bottom inset keeps the mission clear of the docked composer.
  useEffect(() => {
    if (!layout || size.width === 0) return;
    focusOn(layout.bounds, 110, true, COMPOSER_INSETS);
  }, [focusOn, layout, size.width]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLayout(null);
    setError(null);
    setPhase("resting");
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
          {layout && <MissionLayer layout={layout} />}
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
        {layout && (
          <button type="button" onClick={startOver} aria-label="Start a new mission" title="New mission">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16 10a6 6 0 1 1-1.9-4.4M16 4v3h-3" />
            </svg>
          </button>
        )}
        <span className={styles.toolbarRule} aria-hidden="true" />
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

      <Launcher
        phase={PHASE_TO_LAUNCHER[phase]}
        error={error}
        onSubmit={submit}
        onStop={stop}
      />

      {phase === "working" && (
        <p className={styles.working} role="status">
          <i className={styles.workingMark} aria-hidden="true" />
          Cardea is drawing up the plan
        </p>
      )}
    </div>
  );
}
