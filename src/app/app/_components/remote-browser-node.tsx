"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DownstreamMessage,
  type StreamState,
  displayDomain,
} from "@/core/browser-run/protocol";
import styles from "./remote-browser-node.module.css";

/**
 * A board node showing a REAL remote browser: a Cloudflare Browser Run
 * headless Chrome, streamed to this canvas as JPEG frames through Cardea's own
 * same-origin relay at `/api/browser/stream`.
 *
 * VIEW ONLY. Nothing here forwards clicks, keys, or scroll. The badge says so
 * in as many words, and that badge is the only claim this component makes.
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

  const [state, setState] = useState<StreamState>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [hasPainted, setHasPainted] = useState(false);

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

  const sendUpstream = useCallback((message: { t: "pause" | "resume" | "refresh" }) => {
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
          <canvas ref={canvasRef} className={styles.canvas} aria-label={`Live view of ${domain}`} />
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
