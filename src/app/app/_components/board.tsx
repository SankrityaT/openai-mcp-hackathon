"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import {
  MAJOR_EVERY,
  MAX_SCALE,
  MIN_SCALE,
  gridStepFor,
  screenToWorld,
  worldToScreen,
} from "@/core/board/viewport";
import { useBoardView } from "./use-board-view";
import styles from "./board.module.css";

type Sheet = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

const STORAGE_KEY = "cardea-board-v1";
const SHEET_W = 240;
const SHEET_H = 156;
const RULER = 22;

function readStoredSheets(): Sheet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Sheet => {
      if (typeof item !== "object" || item === null) return false;
      const s = item as Partial<Sheet>;
      return (
        typeof s.id === "string" &&
        typeof s.x === "number" &&
        typeof s.y === "number" &&
        typeof s.width === "number" &&
        typeof s.height === "number" &&
        typeof s.text === "string"
      );
    });
  } catch {
    return [];
  }
}

export function CardeaBoard() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const {
    view,
    isPanning,
    spaceHeld,
    zoomBy,
    focusOn,
    resetView,
    beginPan,
    movePan,
    endPan,
  } = useBoardView(surfaceRef);

  // Seeded straight from storage: this component never renders on the server,
  // so there is no markup to mismatch and no restore effect to cascade.
  const [sheets, setSheets] = useState<Sheet[]>(readStoredSheets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{ id: string; pointerId: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
    } catch {
      /* A full or blocked storage quota must not take the board down. */
    }
  }, [sheets]);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const addSheet = useCallback((worldX: number, worldY: number) => {
    const sheet: Sheet = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      x: Math.round(worldX - SHEET_W / 2),
      y: Math.round(worldY - SHEET_H / 2),
      width: SHEET_W,
      height: SHEET_H,
      text: "",
    };
    setSheets((prev) => [...prev, sheet]);
    setSelectedId(sheet.id);
    return sheet;
  }, []);

  const addSheetAtCentre = useCallback(() => {
    const world = screenToWorld(view, size.width / 2, size.height / 2);
    addSheet(world.x, world.y);
  }, [addSheet, size.height, size.width, view]);

  const removeSelected = useCallback(() => {
    setSelectedId((current) => {
      if (current) setSheets((prev) => prev.filter((sheet) => sheet.id !== current));
      return null;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || !!target?.closest("input, textarea");

      if ((event.key === "Backspace" || event.key === "Delete") && !typing && selectedId) {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (typing) return;

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
  }, [removeSelected, resetView, selectedId, zoomBy]);

  const contentBounds = useMemo(() => {
    if (sheets.length === 0) return null;
    const xs = sheets.flatMap((s) => [s.x, s.x + s.width]);
    const ys = sheets.flatMap((s) => [s.y, s.y + s.height]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }, [sheets]);

  const step = gridStepFor(view.scale);
  const minorPx = step * view.scale;
  const majorPx = minorPx * MAJOR_EVERY;
  // Fade the fine rules out as they crowd, so the heavy rules carry structure
  // on their own instead of the whole field turning into flat tone.
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
    // Middle-drag, space-drag, or a plain drag on bare board all pan.
    if (event.button === 1 || event.button === 0) {
      setSelectedId(null);
      beginPan(event);
    }
  }

  function onSurfacePointerMove(event: React.PointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorWorld(screenToWorld(view, event.clientX - rect.left, event.clientY - rect.top));
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = (event.clientX - drag.lastX) / view.scale;
      const dy = (event.clientY - drag.lastY) / view.scale;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      setSheets((prev) =>
        prev.map((sheet) =>
          sheet.id === drag.id ? { ...sheet, x: sheet.x + dx, y: sheet.y + dy } : sheet,
        ),
      );
      return;
    }
    movePan(event);
  }

  function onSurfacePointerUp(event: React.PointerEvent) {
    dragRef.current = null;
    endPan(event);
  }

  function onSurfaceDoubleClick(event: React.MouseEvent) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).dataset.board) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(view, event.clientX - rect.left, event.clientY - rect.top);
    addSheet(world.x, world.y);
  }

  function beginSheetDrag(event: React.PointerEvent, id: string) {
    event.stopPropagation();
    setSelectedId(id);
    if (spaceHeld) {
      beginPan(event);
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
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
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerUp}
        onDoubleClick={onSurfaceDoubleClick}
        role="application"
        aria-label="Cardea board. Drag to pan, pinch or cmd-scroll to zoom, double-click to pin a sheet."
      >
        <div className={styles.paperGrid} style={gridVars} aria-hidden="true" />
        <div className={styles.constellationGrid} style={gridVars} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />

        {/* World layer: one transform carries every object on the board. */}
        <div
          className={styles.world}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg className={styles.origin} viewBox="0 0 80 80" aria-hidden="true" width={80} height={80}>
            <circle cx="40" cy="40" r="15" />
            <circle cx="40" cy="40" r="2.4" className={styles.originDot} />
            <path d="M40 6v20M40 54v20M6 40h20M54 40h20" />
          </svg>

          {sheets.map((sheet) => (
            <article
              key={sheet.id}
              className={styles.sheet}
              data-selected={sheet.id === selectedId || undefined}
              style={{
                transform: `translate(${sheet.x}px, ${sheet.y}px)`,
                width: sheet.width,
                height: sheet.height,
              }}
            >
              <header
                className={styles.sheetGrip}
                onPointerDown={(event) => beginSheetDrag(event, sheet.id)}
              >
                <span className={styles.sheetCoord}>
                  {Math.round(sheet.x)}, {Math.round(sheet.y)}
                </span>
                <button
                  type="button"
                  className={styles.sheetRemove}
                  aria-label="Remove sheet"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setSheets((prev) => prev.filter((s) => s.id !== sheet.id))}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
                </button>
              </header>
              <textarea
                className={styles.sheetBody}
                value={sheet.text}
                spellCheck={false}
                placeholder="Write on the sheet"
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={() => setSelectedId(sheet.id)}
                onChange={(event) =>
                  setSheets((prev) =>
                    prev.map((s) => (s.id === sheet.id ? { ...s, text: event.target.value } : s)),
                  )
                }
              />
            </article>
          ))}
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
        <button type="button" onClick={addSheetAtCentre} aria-label="Pin a new sheet" title="Pin a new sheet">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
            <path d="M10 7.5v5M7.5 10h5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => (contentBounds ? focusOn(contentBounds) : resetView())}
          aria-label={contentBounds ? "Zoom to fit the sheets" : "Return to the origin"}
          title={contentBounds ? "Zoom to fit" : "Return to origin"}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13" />
          </svg>
        </button>
        <span className={styles.toolbarRule} aria-hidden="true" />
        <ThemeToggle />
      </nav>

      <div className={styles.readout}>
        <span className={styles.readoutCoord}>
          {cursorWorld
            ? `${Math.round(cursorWorld.x)}  ${Math.round(cursorWorld.y)}`
            : "—  —"}
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

      {sheets.length === 0 && (
        <p className={styles.hint}>
          <b>Double-click the board</b> to pin a sheet. Drag to pan, hold <kbd>space</kbd> to pan
          anywhere, <kbd>{"⌘"}</kbd>-scroll or pinch to zoom.
        </p>
      )}
    </div>
  );
}
