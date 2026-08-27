/**
 * Pure protocol layer for the remote browser node.
 *
 * Two protocols meet here and neither of them touches a socket:
 *
 * 1. CDP (Chrome DevTools Protocol) framing, spoken upstream to a Cloudflare
 *    Browser Run headless Chrome over its public devtools WebSocket. Commands
 *    are `{id, method, params, sessionId?}`; replies are `{id, result|error}`;
 *    events are `{method, params, sessionId?}`.
 * 2. Cardea's own downstream protocol, spoken to the end user's browser tab:
 *    a small tagged union of frame, status, and nav messages.
 *
 * Keeping both here means the framing, the mandatory screencast ack, and the
 * message encoding are unit-testable without a network, a browser, or a
 * Cloudflare account. Everything that needs a real socket lives in
 * `src/lib/browser-run/`.
 *
 * A note on the word "sessionId", which CDP overloads badly:
 * - the *target* session id is the CDP envelope field, minted by
 *   `Target.attachToTarget` with `flatten: true`, and scopes every later
 *   command to one page;
 * - the *screencast* session id arrives inside `Page.screencastFrame` params
 *   and identifies the frame being acknowledged.
 * They are different values and are never interchangeable. This module names
 * them `targetSessionId` and `frameSessionId` so the distinction survives.
 */

/** Honest states a remote browser surface can be in. No optimistic labels. */
export type StreamState = "connecting" | "streaming" | "paused" | "closed" | "error";

/** Messages the relay sends down to the end user's tab. */
export type DownstreamMessage =
  | { t: "frame"; data: string; w: number; h: number; seq: number }
  | { t: "status"; state: StreamState; detail?: string }
  | { t: "nav"; url: string };

/** Messages the end user's tab sends up to the relay. View-only for now. */
export type UpstreamMessage = { t: "pause" } | { t: "resume" } | { t: "refresh" };

/** A CDP command, before it is serialised. */
export type CdpCommand = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

/** A decoded inbound CDP message: either a reply to a command, or an event. */
export type CdpInbound =
  | { kind: "result"; id: number; result: Record<string, unknown> }
  | { kind: "error"; id: number; code: number | null; message: string }
  | { kind: "event"; method: string; params: Record<string, unknown>; sessionId?: string };

/** Screencast tuning. Deliberately conservative: legibility over fidelity. */
export type ScreencastConfig = {
  format: "jpeg";
  quality: number;
  maxWidth: number;
  maxHeight: number;
  everyNthFrame: number;
};

export const DEFAULT_SCREENCAST: ScreencastConfig = {
  format: "jpeg",
  quality: 60,
  maxWidth: 1024,
  maxHeight: 640,
  everyNthFrame: 1,
};

/** Screenshot cadence used when the screencast never paints. */
export const FALLBACK_SCREENSHOT_INTERVAL_MS = 900;

/**
 * How long to wait for the first `Page.screencastFrame` before deciding the
 * screencast is not going to paint and switching to the screenshot cadence.
 */
export const SCREENCAST_FIRST_FRAME_TIMEOUT_MS = 4_000;

/** Cloudflare caps `keep_alive` at ten minutes. */
export const MAX_KEEP_ALIVE_MS = 600_000;

/** Upper bound on an operator-supplied target URL, before it is parsed. */
export const MAX_TARGET_URL_LENGTH = 2_048;

/**
 * Monotonic CDP command ids. One encoder per socket; ids must never repeat on
 * a connection or replies cannot be matched to their commands.
 */
export function createCdpEncoder(startAt = 0) {
  let id = startAt;
  return {
    /** Builds the next command. `targetSessionId` is omitted for browser-level commands. */
    command(
      method: string,
      params?: Record<string, unknown>,
      targetSessionId?: string,
    ): CdpCommand {
      id += 1;
      const command: CdpCommand = { id, method };
      if (params !== undefined) command.params = params;
      if (targetSessionId !== undefined) command.sessionId = targetSessionId;
      return command;
    },
    /** The last id handed out, for tests and for pending-reply bookkeeping. */
    lastId(): number {
      return id;
    },
  };
}

export function encodeCdpCommand(command: CdpCommand): string {
  return JSON.stringify(command);
}

/**
 * Decodes one inbound CDP frame. Returns null rather than throwing for
 * anything unparseable or unrecognised: a malformed frame from a remote
 * browser must never take the relay down.
 */
export function decodeCdpMessage(raw: string): CdpInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as Record<string, unknown>;

  if (typeof message.id === "number") {
    const error = message.error;
    if (typeof error === "object" && error !== null) {
      const detail = error as Record<string, unknown>;
      return {
        kind: "error",
        id: message.id,
        code: typeof detail.code === "number" ? detail.code : null,
        message: typeof detail.message === "string" ? detail.message : "unknown CDP error",
      };
    }
    const result = message.result;
    return {
      kind: "result",
      id: message.id,
      result: typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {},
    };
  }

  if (typeof message.method === "string") {
    const params = message.params;
    const event: CdpInbound = {
      kind: "event",
      method: message.method,
      params: typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {},
    };
    if (typeof message.sessionId === "string") event.sessionId = message.sessionId;
    return event;
  }

  return null;
}

/** Command that attaches to a page target and switches CDP into flat mode. */
export function attachToTargetCommand(
  encoder: ReturnType<typeof createCdpEncoder>,
  targetId: string,
): CdpCommand {
  return encoder.command("Target.attachToTarget", { targetId, flatten: true });
}

export function startScreencastCommand(
  encoder: ReturnType<typeof createCdpEncoder>,
  targetSessionId: string,
  config: ScreencastConfig = DEFAULT_SCREENCAST,
): CdpCommand {
  return encoder.command("Page.startScreencast", { ...config }, targetSessionId);
}

export function stopScreencastCommand(
  encoder: ReturnType<typeof createCdpEncoder>,
  targetSessionId: string,
): CdpCommand {
  return encoder.command("Page.stopScreencast", undefined, targetSessionId);
}

export function captureScreenshotCommand(
  encoder: ReturnType<typeof createCdpEncoder>,
  targetSessionId: string,
  config: ScreencastConfig = DEFAULT_SCREENCAST,
): CdpCommand {
  return encoder.command(
    "Page.captureScreenshot",
    { format: config.format, quality: config.quality, captureBeyondViewport: false },
    targetSessionId,
  );
}

/**
 * Result of receiving one `Page.screencastFrame`.
 *
 * `ack` is not optional and must be written to the socket immediately.
 * Chrome stops emitting frames until the previous one is acknowledged, so a
 * dropped ack looks exactly like a frozen page.
 */
export type ScreencastFrameOutcome = {
  ack: CdpCommand;
  frame: Extract<DownstreamMessage, { t: "frame" }>;
} | null;

/**
 * Turns a `Page.screencastFrame` event into the downstream frame message plus
 * its mandatory acknowledgement. Returns null when the event is not a
 * screencast frame or is missing its payload, in which case nothing is acked
 * because there is nothing to ack.
 */
export function handleScreencastFrame(
  encoder: ReturnType<typeof createCdpEncoder>,
  event: Extract<CdpInbound, { kind: "event" }>,
  seq: number,
  fallbackSize: { w: number; h: number } = {
    w: DEFAULT_SCREENCAST.maxWidth,
    h: DEFAULT_SCREENCAST.maxHeight,
  },
): ScreencastFrameOutcome {
  if (event.method !== "Page.screencastFrame") return null;
  const data = event.params.data;
  const frameSessionId = event.params.sessionId;
  if (typeof data !== "string" || data.length === 0) return null;
  if (typeof frameSessionId !== "number" && typeof frameSessionId !== "string") return null;

  const metadata =
    typeof event.params.metadata === "object" && event.params.metadata !== null
      ? (event.params.metadata as Record<string, unknown>)
      : {};
  const w = typeof metadata.deviceWidth === "number" ? Math.round(metadata.deviceWidth) : fallbackSize.w;
  const h =
    typeof metadata.deviceHeight === "number" ? Math.round(metadata.deviceHeight) : fallbackSize.h;

  return {
    ack: encoder.command(
      "Page.screencastFrameAck",
      { sessionId: frameSessionId },
      event.sessionId,
    ),
    frame: { t: "frame", data, w, h, seq },
  };
}

/** Turns a `Page.frameNavigated` event into a downstream nav message. */
export function navigationMessage(
  event: Extract<CdpInbound, { kind: "event" }>,
): Extract<DownstreamMessage, { t: "nav" }> | null {
  if (event.method !== "Page.frameNavigated") return null;
  const frame = event.params.frame;
  if (typeof frame !== "object" || frame === null) return null;
  const record = frame as Record<string, unknown>;
  // Only the main frame; a subframe navigating is not a page navigation.
  if (record.parentId !== undefined) return null;
  const url = record.url;
  if (typeof url !== "string" || url.length === 0) return null;
  return { t: "nav", url };
}

export function encodeDownstream(message: DownstreamMessage): string {
  return JSON.stringify(message);
}

export function statusMessage(
  state: StreamState,
  detail?: string,
): Extract<DownstreamMessage, { t: "status" }> {
  return detail === undefined ? { t: "status", state } : { t: "status", state, detail };
}

/** Parses an upstream control message. Unknown shapes resolve to null. */
export function decodeUpstream(raw: string): UpstreamMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const t = (parsed as Record<string, unknown>).t;
  if (t === "pause" || t === "resume" || t === "refresh") return { t };
  return null;
}

/**
 * Accepts only bounded http(s) URLs. Anything else (javascript:, data:, file:,
 * chrome:, an over-long string) is refused, because this URL is handed
 * straight to a real browser.
 */
export function validateTargetUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.length === 0) return null;
  return url;
}

/** The domain shown in the node's address line. Never a full URL, never a claim. */
export function displayDomain(raw: string): string {
  const url = validateTargetUrl(raw);
  if (!url) return "unknown";
  return url.hostname.replace(/^www\./, "");
}

/**
 * Removes the account id and any query string from a Cloudflare devtools URL
 * so it can appear in a log line or an error without leaking account shape.
 * Tokens never appear in these URLs, but account ids still should not travel.
 */
export function redactDevtoolsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/accounts\/[^/]+/, "/accounts/<redacted>");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return "<redacted devtools url>";
  }
}
