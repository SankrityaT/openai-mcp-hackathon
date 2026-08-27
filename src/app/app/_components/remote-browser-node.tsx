"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INPUT_MODIFIER,
  type DownstreamMessage,
  type MouseButton,
  type StreamState,
  type UpstreamMessage,
  displayDomain,
} from "@/core/browser-run/protocol";
import styles from "./remote-browser-node.module.css";

/**
 * A board node showing a REAL remote browser: a Cloudflare Browser Run
 * headless Chrome, streamed to this canvas as JPEG frames through Cardea's own
 * same-origin relay at `/api/browser/stream`.
 *
 * VIEW ONLY BY DEFAULT. Nothing forwards clicks, keys, or scroll unless the
 * relay has reported `interactive`, which it does only after proving an input
 * round trip against the real remote Chrome. Until then the badge says view
 * only and means it, and the canvas is not even focusable. The badge is the
 * only claim this component makes, and it is never made on the client's own
 * authority: `REMOTE_BROWSER_INPUT` being on is not enough.
 *
 * While the canvas holds focus a "You are controlling" chip is visible, which
 * is the control boundary DESIGN.md asks for: the operator should never be
 * unsure whether their keystrokes are going into Cardea or into the remote
 * page. Escape leaves takeover and is the one key never forwarded.
 *
 * USAGE
 *
 *   <RemoteBrowserNode
 *     url="https://example.com/orders"
 *     nodeId={node.id}
 *     title={node.codename}
 *   />
 *
 * The component is self-contained: it opens its own socket on mount, pauses
 * the upstream screencast whenever it is offscreen or the tab is hidden, and
 * closes cleanly on unmount. It is deliberately NOT wired into `board.tsx` or
 * `mission-layer.tsx` yet; the control-room pass owns that placement. Drop it
 * into `NodeCard`'s `children` slot, or render it standalone.
 *
 * The relay 404s unless `REMOTE_BROWSER_ENABLED=1` and Cloudflare credentials
 * are present, in which case this renders its honest unavailable state rather
 * than an empty frame.
 *
 * Visual language is intentionally the same as `node-card.module.css` (tab,
 * address bar, traffic lights, Geist Pixel telemetry) without importing it:
 * that file belongs to the mission card and must stay free to change.
 */

export type RemoteBrowserNodeProps = {
  /** http(s) target the remote browser navigates to. Rejected server side otherwise. */
  url: string;
  /** Board node id. One Cloudflare session per node id, reused on reconnect. */
  nodeId: string;
  /** Node codename shown on the tab. */
  title: string;
};

/** The badge is the honest claim about control. Never soften these strings. */
const STATUS_LABEL: Record<StreamState, string> = {
  connecting: "Remote browser · connecting",
  streaming: "Remote browser · Cloudflare · view only",
  interactive: "Remote browser · Cloudflare · interactive takeover",
  paused: "Remote browser · paused",
  closed: "Remote browser · closed",
  error: "Remote browser · error",
};

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 800;

function backoffFor(attempt: number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** Math.min(attempt, 5);
  // Jitter keeps several nodes from reconnecting in lockstep after an outage.
  return Math.min(MAX_BACKOFF_MS, exponential) * (0.75 + Math.random() * 0.5);
}

/**
 * Pointer moves are throttled to roughly this cadence, flushed on an animation
 * frame. A remote page needs enough moves for hover states to read as live and
 * far fewer than a trackpad emits: 30/s is the point where extra events stop
 * changing what the operator sees and start costing frames.
 */
const MOVE_MIN_INTERVAL_MS = 33;

/** CDP's modifier bitmask, read off a DOM event. */
function modifierMask(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? INPUT_MODIFIER.alt : 0) |
    (event.ctrlKey ? INPUT_MODIFIER.ctrl : 0) |
    (event.metaKey ? INPUT_MODIFIER.meta : 0) |
    (event.shiftKey ? INPUT_MODIFIER.shift : 0)
  );
}

const MOUSE_BUTTON: Record<number, MouseButton> = { 0: "left", 1: "middle", 2: "right" };

/**
 * Client coordinates to a normalised point on the painted frame, or null when
 * the pointer is over the letterbox rather than over the page.
 *
 * The canvas is `object-fit: contain`, so the painted image is centred inside
 * the element and is usually smaller than it. Normalising against the element
 * rect would put every click a constant offset away from where the operator
 * aimed, and the error would change with the node's aspect ratio. Returning
 * null in the letterbox is the honest answer: there is no page pixel there, so
 * there is nothing to click.
 */
function normalisePointer(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const intrinsicWidth = canvas.width;
  const intrinsicHeight = canvas.height;
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) return null;

  const scale = Math.min(rect.width / intrinsicWidth, rect.height / intrinsicHeight);
  const paintedWidth = intrinsicWidth * scale;
  const paintedHeight = intrinsicHeight * scale;
  const left = rect.left + (rect.width - paintedWidth) / 2;
  const top = rect.top + (rect.height - paintedHeight) / 2;

  const x = (clientX - left) / paintedWidth;
  const y = (clientY - top) / paintedHeight;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * base64 JPEG to bytes without a `data:` URL round trip, which `connect-src`
 * would otherwise have to allow.
 */
function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function RemoteBrowserNode({ url, nodeId, title }: RemoteBrowserNodeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  /** Latest visibility intent, read by the socket handlers without re-subscribing. */
  const wantsFramesRef = useRef(true);
  const generationRef = useRef(0);
  /** Indirection so the retry timer can re-enter `connect` without a cycle. */
  const connectRef = useRef<(() => void) | null>(null);

  /** Latest pointer position awaiting its throttled flush, in normalised units. */
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const lastMoveSentRef = useRef(0);
  /** The button currently held down, so leaving the canvas cannot strand it. */
  const heldButtonRef = useRef<{ button: MouseButton; x: number; y: number } | null>(null);

  const [state, setState] = useState<StreamState>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [hasPainted, setHasPainted] = useState(false);
  const [controlling, setControlling] = useState(false);

  const domain = useMemo(() => displayDomain(currentUrl), [currentUrl]);

  const paint = useCallback(async (data: string, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([decodeBase64(data)], { type: "image/jpeg" }));
    } catch {
      // One corrupt frame is not a stream failure. The next frame repaints.
      return;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return;
    }
    context.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    setHasPainted(true);
  }, []);

  const sendUpstream = useCallback((message: UpstreamMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const connect = useCallback(() => {
    const generation = generationRef.current;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const endpoint = `${scheme}://${window.location.host}/api/browser/stream?url=${encodeURIComponent(url)}&nodeId=${encodeURIComponent(nodeId)}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(endpoint);
    } catch {
      // Constructing a WebSocket only throws on a malformed URL, which this
      // cannot produce. Report it out of band rather than from an effect body.
      retryTimerRef.current = setTimeout(() => {
        setState("error");
        setDetail("could not open a connection");
      }, 0);
      return;
    }
    socketRef.current = socket;
    // No setState here on purpose: this runs from the mount effect body, and
    // the initial state is already "connecting". Reconnect paths below set it
    // from a timer or an event handler instead.

    socket.addEventListener("open", () => {
      if (generation !== generationRef.current) return;
      attemptRef.current = 0;
      if (!wantsFramesRef.current) socket.send(JSON.stringify({ t: "pause" }));
    });

    socket.addEventListener("message", (event) => {
      if (generation !== generationRef.current) return;
      if (typeof event.data !== "string") return;
      let message: DownstreamMessage;
      try {
        message = JSON.parse(event.data) as DownstreamMessage;
      } catch {
        return;
      }
      if (message.t === "frame") {
        void paint(message.data, message.w, message.h);
        return;
      }
      if (message.t === "nav") {
        setCurrentUrl(message.url);
        return;
      }
      if (message.t === "status") {
        setState(message.state);
        setDetail(message.detail ?? null);
      }
    });

    const scheduleRetry = () => {
      if (generation !== generationRef.current) return;
      const delay = backoffFor(attemptRef.current);
      attemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        setState("connecting");
        setDetail(null);
        connectRef.current?.();
      }, delay);
    };

    socket.addEventListener("close", (event) => {
      if (generation !== generationRef.current) return;
      socketRef.current = null;
      // 1013 is the relay's honest "at capacity". Retrying would just take a
      // slot from the operator, so stop and let them close a node.
      if (event.code === 1013) {
        setState("error");
        setDetail("two remote browsers are already running");
        return;
      }
      setState("error");
      setDetail((current) => current ?? "connection lost");
      scheduleRetry();
    });

    socket.addEventListener("error", () => {
      // `close` always follows, and it owns the retry.
    });
  }, [nodeId, paint, url]);

  const retryNow = useCallback(() => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    attemptRef.current = 0;
    socketRef.current?.close();
    socketRef.current = null;
    setState("connecting");
    setDetail(null);
    connect();
  }, [connect]);

  // Declared before the mount effect so the ref is current by the time the
  // first connection can schedule a retry.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    generationRef.current += 1;
    connect();
    return () => {
      generationRef.current += 1;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  /**
   * Continuous rendering must not run offscreen or in a hidden tab. Both
   * signals feed one intent, and the pause is upstream: the relay stops the
   * screencast entirely rather than the client throwing frames away.
   */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let onscreen = true;
    const apply = () => {
      const wants = onscreen && document.visibilityState === "visible";
      if (wants === wantsFramesRef.current) return;
      wantsFramesRef.current = wants;
      sendUpstream({ t: wants ? "resume" : "pause" });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        onscreen = entries.some((entry) => entry.isIntersecting);
        apply();
      },
      { threshold: 0.05 },
    );
    observer.observe(shell);
    document.addEventListener("visibilitychange", apply);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [sendUpstream]);

  /**
   * The single gate on every input path below. It is the relay's verified
   * status, not a prop and not the flag: if the round trip was never proven,
   * the canvas is not focusable and nothing is forwarded.
   */
  const isInteractive = state === "interactive";

  const cancelPendingMove = useCallback(() => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    pendingMoveRef.current = null;
  }, []);

  /**
   * Coalesces pointer moves onto animation frames and drops any that would
   * exceed the cadence. A trackpad can emit several hundred moves a second and
   * the remote page can act on about thirty of them.
   */
  const queueMove = useCallback(
    (point: { x: number; y: number }) => {
      pendingMoveRef.current = point;
      if (moveFrameRef.current !== null) return;
      const flush = () => {
        moveFrameRef.current = null;
        const pendingMove = pendingMoveRef.current;
        if (!pendingMove) return;
        const now = performance.now();
        if (now - lastMoveSentRef.current < MOVE_MIN_INTERVAL_MS) {
          // Too soon. Keep the position and try again on the next frame, so
          // the last move of a gesture always lands.
          moveFrameRef.current = requestAnimationFrame(flush);
          return;
        }
        lastMoveSentRef.current = now;
        pendingMoveRef.current = null;
        sendUpstream({ t: "mouse", kind: "move", x: pendingMove.x, y: pendingMove.y });
      };
      moveFrameRef.current = requestAnimationFrame(flush);
    },
    [sendUpstream],
  );

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    return canvas ? normalisePointer(canvas, clientX, clientY) : null;
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // While unfocused, nothing forwards. Hovering a node is not controlling it.
      if (!isInteractive || !controlling) return;
      const point = pointAt(event.clientX, event.clientY);
      if (point) queueMove(point);
    },
    [controlling, isInteractive, pointAt, queueMove],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isInteractive) return;
      const canvas = canvasRef.current;
      // Clicking is how takeover is entered, so focus first and forward second.
      canvas?.focus();
      const point = pointAt(event.clientX, event.clientY);
      if (!point) return;
      const button = MOUSE_BUTTON[event.button];
      if (!button) return;
      try {
        canvas?.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an improvement, not a requirement.
      }
      cancelPendingMove();
      heldButtonRef.current = { button, ...point };
      // A press with no preceding move lands wherever the remote cursor last
      // was, so the move goes first and unthrottled.
      lastMoveSentRef.current = performance.now();
      sendUpstream({ t: "mouse", kind: "move", x: point.x, y: point.y });
      sendUpstream({
        t: "mouse",
        kind: "down",
        x: point.x,
        y: point.y,
        button,
        clickCount: Math.min(Math.max(event.detail || 1, 1), 3),
      });
    },
    [cancelPendingMove, isInteractive, pointAt, sendUpstream],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isInteractive) return;
      const held = heldButtonRef.current;
      if (!held) return;
      heldButtonRef.current = null;
      try {
        canvasRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // Already released, or never captured.
      }
      const point = pointAt(event.clientX, event.clientY) ?? { x: held.x, y: held.y };
      sendUpstream({
        t: "mouse",
        kind: "up",
        x: point.x,
        y: point.y,
        button: held.button,
        clickCount: Math.min(Math.max(event.detail || 1, 1), 3),
      });
    },
    [isInteractive, pointAt, sendUpstream],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!isInteractive) return;
      // Escape is the way out of takeover and is never forwarded. Without a
      // key the operator can trust to give control back, a focused canvas that
      // swallows Tab and Cmd-W is a trap.
      if (event.key === "Escape") {
        event.preventDefault();
        canvasRef.current?.blur();
        return;
      }
      // Only while focused, which is the whole reason focus is the gate: the
      // board's own shortcuts keep working everywhere else.
      event.preventDefault();
      const modifiers = modifierMask(event);
      sendUpstream({ t: "key", kind: "down", key: event.key, code: event.code, modifiers });
      // Printable characters go in through Input.insertText rather than as a
      // keyDown carrying text, so composition and non-BMP characters take the
      // same path. The keyDown above still fires a real keydown on the page,
      // so the character arrives exactly once.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        sendUpstream({ t: "insert", text: event.key });
      }
    },
    [isInteractive, sendUpstream],
  );

  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!isInteractive || event.key === "Escape") return;
      event.preventDefault();
      sendUpstream({
        t: "key",
        kind: "up",
        key: event.key,
        code: event.code,
        modifiers: modifierMask(event),
      });
    },
    [isInteractive, sendUpstream],
  );

  const onBlur = useCallback(() => {
    setControlling(false);
    cancelPendingMove();
    const held = heldButtonRef.current;
    if (held && isInteractive) {
      // Never strand a held button on the remote page.
      heldButtonRef.current = null;
      sendUpstream({ t: "mouse", kind: "up", x: held.x, y: held.y, button: held.button });
    }
    heldButtonRef.current = null;
  }, [cancelPendingMove, isInteractive, sendUpstream]);

  /**
   * Wheel is bound by hand rather than through `onWheel` because React
   * registers its root wheel listener as passive, and a passive listener
   * cannot call `preventDefault`. Without that, scrolling the remote page
   * would also scroll the board underneath it.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isInteractive) return;

    const handle = (event: WheelEvent) => {
      if (document.activeElement !== canvas) return;
      const point = normalisePointer(canvas, event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      sendUpstream({
        t: "mouse",
        kind: "wheel",
        x: point.x,
        y: point.y,
        deltaX: Math.max(-10_000, Math.min(10_000, event.deltaX)),
        deltaY: Math.max(-10_000, Math.min(10_000, event.deltaY)),
      });
    };

    canvas.addEventListener("wheel", handle, { passive: false });
    return () => canvas.removeEventListener("wheel", handle);
  }, [isInteractive, sendUpstream]);

  useEffect(() => cancelPendingMove, [cancelPendingMove]);

  /**
   * Derived, not stored. If the relay stops reporting interactive mid-takeover
   * the chip has to go with it in the same render, and a state reset in an
   * effect would leave one frame claiming control that no longer exists.
   */
  const isControlling = controlling && isInteractive;

  const badge = STATUS_LABEL[state];
  const isPaused = state === "paused";
  const isError = state === "error" || state === "closed";

  return (
    <article
      ref={shellRef}
      className={styles.shell}
      data-state={state}
      aria-label={`${title}. ${badge}.`}
    >
      <div className={styles.tabStrip}>
        <div className={styles.tab}>
          <span className={styles.title}>{title}</span>
        </div>
      </div>

      <div className={styles.chrome}>
        <div className={styles.addressBar}>
          <span className={styles.trafficLights} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.domain} title={currentUrl}>
            {domain}
          </span>
        </div>

        <div className={styles.viewport}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            data-interactive={isInteractive ? "true" : undefined}
            // Only focusable once control is real. A tab stop that does nothing
            // is worse than no tab stop.
            tabIndex={isInteractive ? 0 : undefined}
            aria-label={
              isInteractive
                ? `Live view of ${domain}. Focus this to control the remote browser, Escape to leave.`
                : `Live view of ${domain}`
            }
            onFocus={isInteractive ? () => setControlling(true) : undefined}
            onBlur={onBlur}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={isInteractive ? (event) => event.preventDefault() : undefined}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
          />
          {isControlling && (
            <p className={styles.controlChip}>
              You are controlling
              <span className={styles.controlHint}>Escape to leave</span>
            </p>
          )}
          {!hasPainted && (
            <p className={styles.placeholder}>
              {isError ? "No frames received." : "Waiting for the first frame."}
            </p>
          )}
          {isPaused && hasPainted && (
            <div className={styles.pausedOverlay}>
              <p className={styles.pausedNote}>Paused while offscreen. Showing the last frame.</p>
              <button
                type="button"
                className={styles.action}
                onClick={() => sendUpstream({ t: "refresh" })}
              >
                Refresh once
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.badge}>{badge}</span>
          {detail && <span className={styles.detail}>{detail}</span>}
          {isError && (
            <button type="button" className={styles.action} onClick={retryNow}>
              Retry
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
