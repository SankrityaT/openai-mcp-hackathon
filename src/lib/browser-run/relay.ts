import "server-only";

import { WebSocket as NodeWebSocket, type RawData } from "ws";
import {
  DEFAULT_SCREENCAST,
  FALLBACK_SCREENSHOT_INTERVAL_MS,
  SCREENCAST_FIRST_FRAME_TIMEOUT_MS,
  type CdpCommand,
  type DownstreamMessage,
  type ScreencastConfig,
  attachToTargetCommand,
  captureScreenshotCommand,
  createCdpEncoder,
  decodeCdpMessage,
  encodeCdpCommand,
  handleScreencastFrame,
  navigationMessage,
  redactDevtoolsUrl,
  startScreencastCommand,
  statusMessage,
  stopScreencastCommand,
} from "@/core/browser-run/protocol";
import { getBrowserRunCredentials } from "./config";

/**
 * The socket-bound half of the relay. Everything framing-related lives in
 * `@/core/browser-run/protocol`; this file only owns the `ws` connection, the
 * command/reply bookkeeping, and the timers.
 *
 * Node 22's built-in `WebSocket` cannot set request headers, and Cloudflare's
 * public devtools endpoint requires `Authorization: Bearer`. That, and only
 * that, is why the `ws` package is a dependency here.
 *
 * Two rules are load bearing:
 *  - every `Page.screencastFrame` is acked immediately, or Chrome stops
 *    painting and the node silently freezes;
 *  - the screencast only emits on paint, so one `Page.captureScreenshot` is
 *    issued on attach and the canvas is never blank.
 */

export type RelayOptions = {
  webSocketDebuggerUrl: string;
  /** Already validated as bounded http(s) by the caller. */
  targetUrl: string;
  /** Called for every downstream message. Must not throw. */
  send: (message: DownstreamMessage) => void;
  screencast?: ScreencastConfig;
};

export type RelayHandle = {
  pause: () => void;
  resume: () => void;
  /** Forces one screenshot now, for the manual refresh affordance while paused. */
  refresh: () => void;
  close: () => void;
};

export function attachAndStream(options: RelayOptions): RelayHandle {
  const config = options.screencast ?? DEFAULT_SCREENCAST;
  const { token } = getBrowserRunCredentials();
  const encoder = createCdpEncoder();
  const pending = new Map<number, (result: Record<string, unknown>) => void>();

  let targetSessionId: string | null = null;
  let seq = 0;
  let paused = false;
  let closed = false;
  let mode: "screencast" | "screenshot" = "screencast";
  let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  let screenshotTimer: ReturnType<typeof setInterval> | null = null;

  const socket = new NodeWebSocket(options.webSocketDebuggerUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  options.send(statusMessage("connecting"));

  function emit(message: DownstreamMessage) {
    if (closed) return;
    try {
      options.send(message);
    } catch {
      // A dead downstream socket is the caller's problem, not a reason to
      // tear the upstream browser session down mid-frame.
    }
  }

  function call(command: CdpCommand, onResult?: (result: Record<string, unknown>) => void) {
    if (socket.readyState !== NodeWebSocket.OPEN) return;
    if (onResult) pending.set(command.id, onResult);
    socket.send(encodeCdpCommand(command));
  }

  function clearFirstFrameTimer() {
    if (firstFrameTimer !== null) {
      clearTimeout(firstFrameTimer);
      firstFrameTimer = null;
    }
  }

  function stopScreenshotCadence() {
    if (screenshotTimer !== null) {
      clearInterval(screenshotTimer);
      screenshotTimer = null;
    }
  }

  function takeScreenshot() {
    if (closed || targetSessionId === null) return;
    call(captureScreenshotCommand(encoder, targetSessionId, config), (result) => {
      const data = result.data;
      if (typeof data !== "string" || data.length === 0) return;
      seq += 1;
      emit({ t: "frame", data, w: config.maxWidth, h: config.maxHeight, seq });
    });
  }

  /**
   * The documented fallback: some pages (fully composited, or already painted
   * before the screencast started) never emit a `screencastFrame`. Rather than
   * showing a frozen node, fall back to a screenshot cadence behind the exact
   * same downstream message shape, so the client cannot tell and does not care.
   */
  function startScreenshotCadence(detail: string) {
    if (closed || mode === "screenshot") return;
    mode = "screenshot";
    if (targetSessionId !== null) call(stopScreencastCommand(encoder, targetSessionId));
    stopScreenshotCadence();
    screenshotTimer = setInterval(takeScreenshot, FALLBACK_SCREENSHOT_INTERVAL_MS);
    emit(statusMessage("streaming", detail));
    takeScreenshot();
  }

  function beginStreaming() {
    if (closed || targetSessionId === null || paused) return;
    if (mode === "screenshot") {
      stopScreenshotCadence();
      screenshotTimer = setInterval(takeScreenshot, FALLBACK_SCREENSHOT_INTERVAL_MS);
      takeScreenshot();
      emit(statusMessage("streaming"));
      return;
    }
    call(startScreencastCommand(encoder, targetSessionId, config));
    // Screencast only emits on paint, so prime the canvas immediately.
    takeScreenshot();
    emit(statusMessage("streaming"));
    clearFirstFrameTimer();
    // Cleared by the first real screencast frame. If it ever fires, the
    // screencast is not painting and the cadence takes over.
    firstFrameTimer = setTimeout(() => {
      firstFrameTimer = null;
      startScreenshotCadence("screenshot cadence");
    }, SCREENCAST_FIRST_FRAME_TIMEOUT_MS);
  }

  function attach(targetId: string) {
    call(attachToTargetCommand(encoder, targetId), (result) => {
      const sessionId = result.sessionId;
      if (typeof sessionId !== "string") {
        emit(statusMessage("error", "could not attach to the page"));
        return;
      }
      targetSessionId = sessionId;
      call(encoder.command("Page.enable", undefined, sessionId));
      call(encoder.command("Page.navigate", { url: options.targetUrl }, sessionId), () => {
        beginStreaming();
      });
    });
  }

  socket.on("open", () => {
    call(encoder.command("Target.getTargets"), (result) => {
      const infos = Array.isArray(result.targetInfos) ? result.targetInfos : [];
      const page = infos.find((info): info is { targetId: string; type: string } => {
        if (typeof info !== "object" || info === null) return false;
        const record = info as Record<string, unknown>;
        return record.type === "page" && typeof record.targetId === "string";
      });
      if (page) {
        attach(page.targetId);
        return;
      }
      call(encoder.command("Target.createTarget", { url: "about:blank" }), (created) => {
        const targetId = created.targetId;
        if (typeof targetId !== "string") {
          emit(statusMessage("error", "no page target available"));
          return;
        }
        attach(targetId);
      });
    });
  });

  socket.on("message", (raw: RawData) => {
    const message = decodeCdpMessage(raw.toString());
    if (!message) return;

    if (message.kind === "result") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.result);
      return;
    }

    if (message.kind === "error") {
      pending.delete(message.id);
      // CDP error text can echo the navigated URL but never a credential.
      emit(statusMessage("error", message.message));
      return;
    }

    const frame = handleScreencastFrame(encoder, message, seq + 1, {
      w: config.maxWidth,
      h: config.maxHeight,
    });
    if (frame) {
      // Ack first, always, and before any downstream work that could throw.
      call(frame.ack);
      clearFirstFrameTimer();
      seq += 1;
      if (!paused) emit(frame.frame);
      return;
    }

    const nav = navigationMessage(message);
    if (nav) emit(nav);
  });

  socket.on("error", () => {
    // The message would contain the devtools URL; report the redacted form.
    emit(statusMessage("error", `upstream socket failed: ${redactDevtoolsUrl(options.webSocketDebuggerUrl)}`));
  });

  socket.on("close", () => {
    clearFirstFrameTimer();
    stopScreenshotCadence();
    if (!closed) {
      closed = true;
      emit(statusMessage("closed"));
    }
  });

  return {
    pause() {
      if (paused || closed) return;
      paused = true;
      clearFirstFrameTimer();
      stopScreenshotCadence();
      if (targetSessionId !== null && mode === "screencast") {
        call(stopScreencastCommand(encoder, targetSessionId));
      }
      emit(statusMessage("paused"));
    },
    resume() {
      if (!paused || closed) return;
      paused = false;
      beginStreaming();
    },
    refresh() {
      takeScreenshot();
    },
    close() {
      if (closed) return;
      emit(statusMessage("closed"));
      closed = true;
      clearFirstFrameTimer();
      stopScreenshotCadence();
      try {
        socket.close(1000, "relay closed");
      } catch {
        socket.terminate();
      }
    },
  };
}
