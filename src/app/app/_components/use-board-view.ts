"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type View, clamp, fitToBox, zoomAbout } from "@/core/board/viewport";

type PanSession = {
  pointerId: number;
  lastX: number;
  lastY: number;
};

export function useBoardView(surfaceRef: React.RefObject<HTMLElement | null>) {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panRef = useRef<PanSession | null>(null);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setView((prev) => zoomAbout(prev, factor, sx, sy));
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = surfaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(factor, rect.width / 2, rect.height / 2);
    },
    [surfaceRef, zoomAt],
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  /** Centre a world rectangle in the viewport at a scale that fits it. */
  const focusOn = useCallback(
    (box: { x: number; y: number; width: number; height: number }, padding?: number) => {
      const el = surfaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setView(fitToBox(box, { width: rect.width, height: rect.height }, padding));
    },
    [surfaceRef],
  );

  const resetView = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setView({ scale: 1, x: rect.width / 2, y: rect.height / 2 });
  }, [surfaceRef]);

  // Put the world origin in the middle of the viewport on first paint, so the
  // registration mark reads as the centre of the board rather than a corner.
  useEffect(() => {
    resetView();
  }, [resetView]);

  // Wheel has to be a non-passive native listener: React's synthetic handler
  // cannot preventDefault the browser's own page zoom / overscroll.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      // Browsers report trackpad pinch as ctrl+wheel; cmd/ctrl+wheel is the
      // mouse equivalent. Everything else is a two-axis pan.
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch arrives as many tiny deltas, a mouse notch as one
        // large one. The exponent keeps pinch smooth; the clamp stops a single
        // notch from crossing the entire zoom range.
        const factor = Math.exp(-event.deltaY * 0.0115);
        zoomAt(clamp(factor, 0.86, 1.16), px, py);
        return;
      }
      setView((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [surfaceRef, zoomAt]);

  // Space is the hold-to-pan modifier, so dragging still works over objects.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea")) return;
      event.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    function onBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const beginPan = useCallback((event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
  }, []);

  const movePan = useCallback((event: React.PointerEvent) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.lastX;
    const dy = event.clientY - session.lastY;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const endPan = useCallback((event: React.PointerEvent) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  }, []);

  return {
    view,
    setView,
    isPanning,
    spaceHeld,
    zoomAt,
    zoomBy,
    panBy,
    focusOn,
    resetView,
    beginPan,
    movePan,
    endPan,
  };
}
