import "server-only";

import { WebSocket as NodeWebSocket, type RawData } from "ws";
import {
  DEFAULT_SCREENCAST,
  FALLBACK_SCREENSHOT_INTERVAL_MS,
  INPUT_ROUND_TRIP_BUDGET_MS,
  INPUT_VERIFY_TIMEOUT_MS,
  SCREENCAST_FIRST_FRAME_TIMEOUT_MS,
  type CdpCommand,
  type DownstreamMessage,
  type InputMessage,
  type RemoteViewport,
  type ScreencastConfig,
  type StreamState,
  attachToTargetCommand,
  captureScreenshotCommand,
  createCdpEncoder,
  decodeCdpMessage,
  encodeCdpCommand,
  handleScreencastFrame,
  inputCommand,
  inputVerificationProbe,
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
 *
 * Input forwarding is off unless the caller passes `inputEnabled: true`, and
 * even then the node stays view only until the verification echo below proves
 * a round trip. Input never gets to take the frame stream down: a rejected
 * command is reported as a detail on a still-streaming status, because a
 * refused keystroke is a smaller failure than a frozen browser.
 */

export type RelayOptions = {
  webSocketDebuggerUrl: string;
  /** Already validated as bounded http(s) by the caller. */
  targetUrl: string;
  /** Called for every downstream message. Must not throw. */
  send: (message: DownstreamMessage) => void;
  screencast?: ScreencastConfig;
  /**
   * Gates the entire input path. When false (the default) `input()` is a
   * no-op, no synthetic probe is dispatched, and the downstream never sees
   * "interactive". The route derives this from `REMOTE_BROWSER_INPUT`.
   */
  inputEnabled?: boolean;
  /**
   * The tab this node already owns inside the shared browser, from the
   * ledger. When it still exists the relay reattaches to it without
   * renavigating, which is the whole point of the reattach grace period:
   * the page state survives a reload. When absent or gone, a fresh tab is
   * created instead.
   */
  existingTargetId?: string | null;
  /** Reports the tab created for this node, so the ledger can record it. */
  onTargetCreated?: (targetId: string) => void;
  /**
   * The upstream browser socket died without `close()` being called.
   * `streamed` says whether a frame ever arrived: a socket that never
   * painted almost always means the shared browser itself is gone.
   */
  onUpstreamGone?: (streamed: boolean) => void;
};

export type RelayHandle = {
  pause: () => void;
  resume: () => void;
  /** Forces one screenshot now, for the manual refresh affordance while paused. */
  refresh: () => void;
  /** Forwards one already-decoded input message. Ignored unless input is enabled. */
  input: (message: InputMessage) => void;
  close: () => void;
};

export function attachAndStream(options: RelayOptions): RelayHandle {
  const config = options.screencast ?? DEFAULT_SCREENCAST;
  const inputEnabled = options.inputEnabled === true;
  // The screencast is capped to these dimensions, so this is the coordinate
  // space every normalised pointer event is scaled into.
  const viewport: RemoteViewport = { width: config.maxWidth, height: config.maxHeight };
  const { token } = getBrowserRunCredentials();
  const encoder = createCdpEncoder();
  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  /** Ids of in-flight input commands, so their failures never read as stream failures. */
  const inputCommandIds = new Set<number>();

  let targetSessionId: string | null = null;
  let seq = 0;
  let paused = false;
  let closed = false;
  let mode: "screencast" | "screenshot" = "screencast";
  let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  let screenshotTimer: ReturnType<typeof setInterval> | null = null;
  let sawFrame = false;
  let inputVerified = false;
  let verifyStartedAt = 0;
  let awaitingVerifyFrame = false;
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  let verifyAttempted = false;
  /** Measured latency of the synthetic probe's CDP reply, once it arrives. */
  let probeRoundTripMs: number | null = null;
  let roundTripDetail: string | null = null;

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

  function clearVerifyTimer() {
    if (verifyTimer !== null) {
      clearTimeout(verifyTimer);
      verifyTimer = null;
    }
  }

  /**
   * The status to report while frames are flowing.
   *
   * Once the round trip is proven, every later "still streaming" message must
   * say `interactive`, or resuming from a pause would silently demote a
   * working takeover back to a view-only badge.
   */
  function liveStatus(detail?: string) {
    const state: StreamState = inputVerified ? "interactive" : "streaming";
    if (detail !== undefined) return statusMessage(state, detail);
    if (inputVerified && roundTripDetail !== null) return statusMessage(state, roundTripDetail);
    return statusMessage(state);
  }

  /**
   * Forwards one input message. Returns false when nothing went out.
   *
   * Every failure mode here is contained: an invalid message, a closed socket,
   * or a CDP rejection produces at most a detail on a still-streaming status.
   * A refused keystroke is a far smaller failure than a frozen browser.
   */
  function sendInput(
    message: InputMessage,
    onResult?: (result: Record<string, unknown>) => void,
  ): boolean {
    if (closed || targetSessionId === null) return false;
    if (socket.readyState !== NodeWebSocket.OPEN) return false;

    let command: CdpCommand | null = null;
    try {
      command = inputCommand(encoder, targetSessionId, message, viewport);
    } catch {
      command = null;
    }
    if (!command) {
      emit(liveStatus("input_error"));
      return false;
    }

    const id = command.id;
    inputCommandIds.add(id);
    try {
      call(command, (result) => {
        inputCommandIds.delete(id);
        onResult?.(result);
      });
    } catch {
      inputCommandIds.delete(id);
      emit(liveStatus("input_error"));
      return false;
    }
    return true;
  }

  /**
   * The verification echo, and the only thing that may promote a node to
   * "interactive".
   *
   * Two independent facts have to line up before the badge is allowed to claim
   * takeover:
   *
   *  1. the remote Chrome returned a CDP result for a synthetic `mouseMoved`,
   *     which is proof it accepted and processed a real input event rather
   *     than merely staying connected. The elapsed time for that reply is the
   *     measured round trip, reported against INPUT_ROUND_TRIP_BUDGET_MS;
   *  2. a frame arrived afterwards, which is proof the picture the operator is
   *     about to click on is still being painted.
   *
   * Started from the first delivered frame rather than from attach, so the
   * priming screenshot cannot be mistaken for the echo. One attempt only. On
   * timeout the node falls back silently to view only, because a badge that
   * promises control it has not proven is the one failure mode this whole
   * mechanism exists to prevent.
   */
  function beginVerification() {
    if (!inputEnabled || verifyAttempted || closed || targetSessionId === null) return;
    verifyAttempted = true;
    verifyStartedAt = Date.now();
    awaitingVerifyFrame = true;

    const dispatched = sendInput(inputVerificationProbe(), () => {
      probeRoundTripMs = Date.now() - verifyStartedAt;
    });
    if (!dispatched) {
      awaitingVerifyFrame = false;
      emit(statusMessage("streaming", "input_unverified"));
      return;
    }

    verifyTimer = setTimeout(() => {
      verifyTimer = null;
      if (inputVerified || closed) return;
      awaitingVerifyFrame = false;
      emit(statusMessage("streaming", "input_unverified"));
    }, INPUT_VERIFY_TIMEOUT_MS);
  }

  function completeVerification() {
    if (inputVerified || probeRoundTripMs === null) return;
    awaitingVerifyFrame = false;
    clearVerifyTimer();
    inputVerified = true;
    roundTripDetail = `round trip ${probeRoundTripMs}ms, budget ${INPUT_ROUND_TRIP_BUDGET_MS}ms`;
    emit(statusMessage("interactive", roundTripDetail));
  }

  /**
   * Called after every frame that actually reached the downstream. This is the
   * only observation point the verification echo has that the picture is still
   * moving. Skipped while paused, where the single manual refresh frame proves
   * nothing about a stream that is deliberately stopped.
   */
  function noteFrameDelivered() {
    if (paused || !inputEnabled) return;
    if (awaitingVerifyFrame) completeVerification();
    else beginVerification();
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
      sawFrame = true;
      emit({ t: "frame", data, w: config.maxWidth, h: config.maxHeight, seq });
      noteFrameDelivered();
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
    // The screencast and the screenshot cadence are genuinely different frames
    // pipelines, and a page that never repaints will fail verification under
    // the first and pass under the second. Switching earns one fresh attempt;
    // this is not a retry loop, because there are only ever two modes.
    if (!inputVerified) {
      clearVerifyTimer();
      verifyAttempted = false;
      awaitingVerifyFrame = false;
      probeRoundTripMs = null;
    }
    if (targetSessionId !== null) call(stopScreencastCommand(encoder, targetSessionId));
    stopScreenshotCadence();
    screenshotTimer = setInterval(takeScreenshot, FALLBACK_SCREENSHOT_INTERVAL_MS);
    emit(liveStatus(detail));
    takeScreenshot();
  }

  function beginStreaming() {
    if (closed || targetSessionId === null || paused) return;
    if (mode === "screenshot") {
      stopScreenshotCadence();
      screenshotTimer = setInterval(takeScreenshot, FALLBACK_SCREENSHOT_INTERVAL_MS);
      takeScreenshot();
      emit(liveStatus());
      return;
    }
    call(startScreencastCommand(encoder, targetSessionId, config));
    // Screencast only emits on paint, so prime the canvas immediately.
    takeScreenshot();
    emit(liveStatus());
    clearFirstFrameTimer();
    // Cleared by the first real screencast frame. If it ever fires, the
    // screencast is not painting and the cadence takes over.
    firstFrameTimer = setTimeout(() => {
      firstFrameTimer = null;
      startScreenshotCadence("screenshot cadence");
    }, SCREENCAST_FIRST_FRAME_TIMEOUT_MS);
  }

  function attach(targetId: string, navigate: boolean) {
    call(attachToTargetCommand(encoder, targetId), (result) => {
      const sessionId = result.sessionId;
      if (typeof sessionId !== "string") {
        emit(statusMessage("error", "could not attach to the page"));
        return;
      }
      targetSessionId = sessionId;
      call(encoder.command("Page.enable", undefined, sessionId));
      // The page must be the size every frame is labelled as and every
      // pointer event is scaled into. Cloudflare's default viewport is
      // 780x493 (measured over CDP, not assumed); without this override the
      // tile stretched that into 1024x640 and scaled clicks into 1024x640,
      // so a click at the tile's centre landed 66% across the real page and
      // every takeover click missed down and to the right. Applied on
      // reattach as well: an inherited tab has to match too.
      call(
        encoder.command(
          "Emulation.setDeviceMetricsOverride",
          { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false },
          sessionId,
        ),
      );
      if (!navigate) {
        // A reattach inherits the page exactly where the last socket left
        // it; renavigating would throw that state away.
        beginStreaming();
        return;
      }
      call(encoder.command("Page.navigate", { url: options.targetUrl }, sessionId), () => {
        beginStreaming();
      });
    });
  }

  socket.on("open", () => {
    // The browser is shared: other nodes own their own tabs in it, so this
    // relay never adopts a page it did not create. It reattaches to its own
    // recorded tab when that tab still exists, and creates a fresh one
    // otherwise.
    call(encoder.command("Target.getTargets"), (result) => {
      const infos = Array.isArray(result.targetInfos) ? result.targetInfos : [];
      const ownTab = options.existingTargetId
        ? infos.find((info): info is { targetId: string; type: string } => {
            if (typeof info !== "object" || info === null) return false;
            const record = info as Record<string, unknown>;
            return record.type === "page" && record.targetId === options.existingTargetId;
          })
        : undefined;
      if (ownTab) {
        attach(ownTab.targetId, false);
        return;
      }
      // `newWindow` is load bearing: tabs sharing one window render only
      // while foregrounded, so a second tile's screencast would silently
      // freeze. A window per tile keeps every tile painting concurrently
      // (verified live against Cloudflare before this shipped).
      call(encoder.command("Target.createTarget", { url: "about:blank", newWindow: true }), (created) => {
        const targetId = created.targetId;
        if (typeof targetId !== "string") {
          emit(statusMessage("error", "no page target available"));
          return;
        }
        options.onTargetCreated?.(targetId);
        attach(targetId, true);
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
      // A refused input event is not a stream failure. Report it as telemetry
      // on a still-live status and keep painting.
      if (inputCommandIds.delete(message.id)) {
        emit(liveStatus("input_error"));
        return;
      }
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
      sawFrame = true;
      if (!paused) emit(frame.frame);
      noteFrameDelivered();
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
    clearVerifyTimer();
    stopScreenshotCadence();
    if (!closed) {
      closed = true;
      emit(statusMessage("closed"));
      options.onUpstreamGone?.(sawFrame);
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
    /**
     * Forwards one input message to the remote page.
     *
     * Silently ignored when the flag is off, which is what makes
     * `REMOTE_BROWSER_INPUT` a real kill switch rather than a UI preference: a
     * client that fabricates input messages against a disabled deployment
     * moves nothing.
     */
    input(message: InputMessage) {
      if (!inputEnabled || closed) return;
      sendInput(message);
    },
    close() {
      if (closed) return;
      emit(statusMessage("closed"));
      closed = true;
      clearFirstFrameTimer();
      clearVerifyTimer();
      stopScreenshotCadence();
      try {
        socket.close(1000, "relay closed");
      } catch {
        socket.terminate();
      }
    },
  };
}
