"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Insets, type View, clamp, fitToBox, zoomAbout } from "@/core/board/viewport";

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
  const tweenRef = useRef<number | null>(null);

  // Mirrors the latest view for imperative readers. A tween needs its start
  // value synchronously, and a setView updater does not run until React
  // renders -- reading one at tween start yields nothing at all. Written from
  // a layout effect so the mirror is current before anything can paint or
  // handle an event against it.
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const cancelTween = useCallback(() => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    tweenRef.current = null;
  }, []);

  /**
   * Eases the camera to a target view. Any direct interaction cancels it, so a
   * running animation can never fight the pointer.
   */
  const animateTo = useCallback(
    (target: View, duration = 900) => {
      cancelTween();
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || duration <= 0) {
        setView(target);
        return;
      }

      const base = viewRef.current;
      let startedAt = 0;
      const step = (now: number) => {
        if (startedAt === 0) startedAt = now;
        const t = Math.min(1, (now - startedAt) / duration);
        // easeInOutCubic: settles rather than arriving abruptly.
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        setView({
          x: base.x + (target.x - base.x) * eased,
          y: base.y + (target.y - base.y) * eased,
          // Scale interpolates geometrically so the zoom reads as constant
          // speed rather than lurching at the wide end.
          scale: base.scale * Math.pow(target.scale / base.scale, eased),
        });
        if (t < 1) {
          tweenRef.current = requestAnimationFrame(step);
        } else {
          tweenRef.current = null;
        }
      };
      tweenRef.current = requestAnimationFrame(step);
    },
    [cancelTween],
  );

  useEffect(() => cancelTween, [cancelTween]);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      cancelTween();
      setView((prev) => zoomAbout(prev, factor, sx, sy));
    },
    [cancelTween],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const el = surfaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(factor, rect.width / 2, rect.height / 2);
    },
    [surfaceRef, zoomAt],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      cancelTween();
      setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    },
    [cancelTween],
  );

  /** Centre a world rectangle in the viewport at a scale that fits it. */
  const focusOn = useCallback(
    (
      box: { x: number; y: number; width: number; height: number },
      padding?: number,
      animate = false,
      insets?: Insets,
    ) => {
      const el = surfaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const target = fitToBox(box, { width: rect.width, height: rect.height }, padding, insets);
      if (animate) animateTo(target);
      else setView(target);
    },
    [animateTo, surfaceRef],
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
      cancelTween();
      setView((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cancelTween, surfaceRef, zoomAt]);

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
    cancelTween();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
  }, [cancelTween]);

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
    viewRef,
    setView,
    animateTo,
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
