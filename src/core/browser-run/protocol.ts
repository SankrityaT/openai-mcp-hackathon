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

/**
 * Honest states a remote browser surface can be in. No optimistic labels.
 *
 * "interactive" is deliberately NOT a synonym for "input is switched on". It
 * is reported only after a synthetic input event has been dispatched to the
 * remote Chrome and a frame has come back, i.e. after a proven round trip. A
 * deployment with `REMOTE_BROWSER_INPUT=1` that never completes that round
 * trip stays "streaming" and the node keeps saying view only.
 */
export type StreamState =
  | "connecting"
  | "streaming"
  | "interactive"
  | "paused"
  | "closed"
  | "error";

/** Messages the relay sends down to the end user's tab. */
export type DownstreamMessage =
  | { t: "frame"; data: string; w: number; h: number; seq: number }
  | { t: "status"; state: StreamState; detail?: string }
  | { t: "nav"; url: string };

/** Mouse buttons CDP accepts by name. */
export type MouseButton = "left" | "middle" | "right";

/**
 * Input messages the end user's tab sends up to the relay.
 *
 * COORDINATES ARE NORMALISED. `x` and `y` are finite floats in [0, 1] against
 * the painted frame: not against the client canvas element, and not against
 * the remote viewport. The client cannot know the remote viewport and the
 * relay cannot know the client's canvas size, so the frame is the only shared
 * frame of reference. The relay scales into device pixels with
 * `scaleNormalisedPoint`. That is why resizing a node, zooming the board, or
 * letterboxing a 1024x640 frame into a short node cannot desync the pointer.
 */
export type InputMessage =
  | {
      t: "mouse";
      kind: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      button?: MouseButton;
      deltaX?: number;
      deltaY?: number;
      clickCount?: number;
    }
  | { t: "key"; kind: "down" | "up"; key: string; code: string; text?: string; modifiers?: number }
  | { t: "insert"; text: string };

/** Messages the end user's tab sends up to the relay. */
export type UpstreamMessage =
  | { t: "pause" }
  | { t: "resume" }
  | { t: "refresh" }
  | InputMessage;

/** True for the input half of the upstream union, which the relay gates on a flag. */
export function isInputMessage(message: UpstreamMessage): message is InputMessage {
  return message.t === "mouse" || message.t === "key" || message.t === "insert";
}

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

/* ---- Input forwarding ------------------------------------------------- */

/**
 * The demo latency budget for one input round trip: client keypress or click,
 * out to Cloudflare's Chrome, back as a painted frame.
 *
 * This is a JUDGEMENT AID, not an enforcement threshold. Nothing is cancelled
 * for exceeding it. The relay measures the verification echo and reports the
 * measurement in the `interactive` status detail so the operator can decide,
 * at the Sept 1 checkpoint, whether interactive takeover is demo-worthy on the
 * night or whether the node should stay view only.
 */
export const INPUT_ROUND_TRIP_BUDGET_MS = 800;

/**
 * How long the relay waits for the verification echo before giving up and
 * falling back to view only. Deliberately well above the budget: a slow round
 * trip is a quality signal, a missing one is a correctness signal.
 */
export const INPUT_VERIFY_TIMEOUT_MS = 1_500;

/** Upper bound on any single text payload forwarded to the remote browser. */
export const MAX_INPUT_TEXT_LENGTH = 2_000;

/** Upper bound on a `key`/`code` identifier. "MediaTrackPrevious" is 18. */
export const MAX_KEY_NAME_LENGTH = 64;

/** Upper bound on one wheel tick, in CSS pixels. Absurd deltas are refused. */
export const MAX_WHEEL_DELTA = 10_000;

/** Upper bound on `clickCount`. Triple click is the deepest gesture a page reads. */
export const MAX_CLICK_COUNT = 3;

/** CDP's modifier bitmask. Not the DOM's, and not the same order. */
export const INPUT_MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

/** Every modifier set at once. Any higher value is not a modifier mask. */
export const MAX_INPUT_MODIFIERS =
  INPUT_MODIFIER.alt | INPUT_MODIFIER.ctrl | INPUT_MODIFIER.meta | INPUT_MODIFIER.shift;

/** CDP's `buttons` bitmask, which is a different encoding to its `button` name. */
const BUTTON_BIT: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

const MOUSE_CDP_TYPE = {
  move: "mouseMoved",
  down: "mousePressed",
  up: "mouseReleased",
  wheel: "mouseWheel",
} as const;

const KEY_CDP_TYPE = { down: "keyDown", up: "keyUp" } as const;

/** The remote viewport an input event is scaled into, in device pixels. */
export type RemoteViewport = { width: number; height: number };

/**
 * The viewport the screencast is capped to, and therefore the coordinate space
 * every forwarded pointer event lands in.
 */
export const DEFAULT_REMOTE_VIEWPORT: RemoteViewport = {
  width: DEFAULT_SCREENCAST.maxWidth,
  height: DEFAULT_SCREENCAST.maxHeight,
};

function isNormalised(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_INPUT_TEXT_LENGTH;
}

/**
 * Maps a normalised [0, 1] point onto the remote viewport's device pixels.
 *
 * The right edge maps to `width - 1`, not to `width`: a normalised 1.0 means
 * "the last painted column", and dispatching at `width` would land one pixel
 * outside the page. Results are integers because sub-pixel pointer coordinates
 * buy nothing and make hit testing harder to reason about.
 */
export function scaleNormalisedPoint(
  x: number,
  y: number,
  viewport: RemoteViewport = DEFAULT_REMOTE_VIEWPORT,
): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));
  return {
    x: clamp(Math.round(x * viewport.width), viewport.width - 1),
    y: clamp(Math.round(y * viewport.height), viewport.height - 1),
  };
}

/**
 * Validates one already-parsed input message. Exported because the relay
 * re-checks in depth: the client is the one place this protocol cannot trust,
 * and an unbounded string or a NaN coordinate reaches a real browser.
 */
export function isValidInputMessage(message: InputMessage): boolean {
  if (message.t === "insert") return isBoundedText(message.text);

  if (message.t === "key") {
    if (message.kind !== "down" && message.kind !== "up") return false;
    if (typeof message.key !== "string" || message.key.length === 0) return false;
    if (message.key.length > MAX_KEY_NAME_LENGTH) return false;
    if (typeof message.code !== "string" || message.code.length > MAX_KEY_NAME_LENGTH) return false;
    if (message.text !== undefined && !isBoundedText(message.text)) return false;
    if (message.modifiers !== undefined) {
      const m = message.modifiers;
      if (!Number.isInteger(m) || m < 0 || m > MAX_INPUT_MODIFIERS) return false;
    }
    return true;
  }

  if (message.t !== "mouse") return false;
  if (MOUSE_CDP_TYPE[message.kind] === undefined) return false;
  if (!isNormalised(message.x) || !isNormalised(message.y)) return false;
  if (message.button !== undefined && BUTTON_BIT[message.button] === undefined) return false;
  for (const delta of [message.deltaX, message.deltaY]) {
    if (delta === undefined) continue;
    if (typeof delta !== "number" || !Number.isFinite(delta)) return false;
    if (Math.abs(delta) > MAX_WHEEL_DELTA) return false;
  }
  if (message.clickCount !== undefined) {
    const count = message.clickCount;
    if (!Number.isInteger(count) || count < 0 || count > MAX_CLICK_COUNT) return false;
  }
  return true;
}

/**
 * Builds the CDP command for one input message, or null when the message does
 * not survive validation.
 *
 * The mapping, in full:
 *
 *   {t:"mouse", kind:"move"}   Input.dispatchMouseEvent  type mouseMoved
 *   {t:"mouse", kind:"down"}   Input.dispatchMouseEvent  type mousePressed
 *   {t:"mouse", kind:"up"}     Input.dispatchMouseEvent  type mouseReleased
 *   {t:"mouse", kind:"wheel"}  Input.dispatchMouseEvent  type mouseWheel
 *   {t:"key",   kind:"down"}   Input.dispatchKeyEvent    type keyDown
 *   {t:"key",   kind:"up"}     Input.dispatchKeyEvent    type keyUp
 *   {t:"insert"}               Input.insertText
 *
 * Text insertion goes through `Input.insertText` rather than a `keyDown`
 * carrying `text`, because that is the path that handles IME composition,
 * pasted runs, and non-BMP characters identically. A `keyDown` without `text`
 * still fires a real `keydown` on the page, so the client can send both and
 * the page sees the event *and* the character exactly once.
 *
 * `buttons` is a bitmask and `button` is a name. They are not the same
 * encoding and Chrome uses both: `button` says which button this event is
 * about, `buttons` says which are held. Moves and wheels hold nothing.
 */
export function inputCommand(
  encoder: ReturnType<typeof createCdpEncoder>,
  targetSessionId: string,
  message: InputMessage,
  viewport: RemoteViewport = DEFAULT_REMOTE_VIEWPORT,
): CdpCommand | null {
  if (!isValidInputMessage(message)) return null;

  if (message.t === "insert") {
    return encoder.command("Input.insertText", { text: message.text }, targetSessionId);
  }

  if (message.t === "key") {
    const params: Record<string, unknown> = {
      type: KEY_CDP_TYPE[message.kind],
      key: message.key,
      code: message.code,
      modifiers: message.modifiers ?? 0,
    };
    if (message.text !== undefined) params.text = message.text;
    return encoder.command("Input.dispatchKeyEvent", params, targetSessionId);
  }

  const point = scaleNormalisedPoint(message.x, message.y, viewport);
  const pressing = message.kind === "down";
  const named = message.button ?? "left";
  const params: Record<string, unknown> = {
    type: MOUSE_CDP_TYPE[message.kind],
    x: point.x,
    y: point.y,
    modifiers: 0,
  };

  if (message.kind === "down" || message.kind === "up") {
    params.button = named;
    // On release nothing is held any more, so the held mask is empty.
    params.buttons = pressing ? BUTTON_BIT[named] : 0;
    params.clickCount = message.clickCount ?? 1;
  } else {
    params.button = "none";
    params.buttons = 0;
  }

  if (message.kind === "wheel") {
    params.deltaX = message.deltaX ?? 0;
    params.deltaY = message.deltaY ?? 0;
  }

  return encoder.command("Input.dispatchMouseEvent", params, targetSessionId);
}

/**
 * The synthetic event used to verify the input path. A centred `mouseMoved`
 * is the only input Chrome will accept that cannot click a link, submit a
 * form, type a character, or scroll a page: verification must never mutate
 * whatever the operator is about to demo.
 */
export function inputVerificationProbe(): InputMessage {
  return { t: "mouse", kind: "move", x: 0.5, y: 0.5 };
}

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

/**
 * Parses an upstream control or input message. Unknown shapes resolve to null.
 *
 * Every field is re-read off the parsed object rather than spread from it, so
 * a client cannot smuggle extra keys into a CDP `params` object, and every
 * bound is applied here rather than trusted downstream. Unknown `kind` values
 * are rejected even when `t` is known.
 */
export function decodeUpstream(raw: string): UpstreamMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const t = record.t;
  if (t === "pause" || t === "resume" || t === "refresh") return { t };

  if (t === "insert") {
    if (!isBoundedText(record.text)) return null;
    return { t: "insert", text: record.text };
  }

  if (t === "key") {
    const kind = record.kind;
    if (kind !== "down" && kind !== "up") return null;
    if (typeof record.key !== "string" || typeof record.code !== "string") return null;
    const message: InputMessage = { t: "key", kind, key: record.key, code: record.code };
    if (record.text !== undefined) {
      if (typeof record.text !== "string") return null;
      message.text = record.text;
    }
    if (record.modifiers !== undefined) {
      if (typeof record.modifiers !== "number") return null;
      message.modifiers = record.modifiers;
    }
    return isValidInputMessage(message) ? message : null;
  }

  if (t === "mouse") {
    const kind = record.kind;
    if (kind !== "move" && kind !== "down" && kind !== "up" && kind !== "wheel") return null;
    if (typeof record.x !== "number" || typeof record.y !== "number") return null;
    const message: InputMessage = { t: "mouse", kind, x: record.x, y: record.y };
    if (record.button !== undefined) {
      if (typeof record.button !== "string") return null;
      message.button = record.button as MouseButton;
    }
    for (const axis of ["deltaX", "deltaY"] as const) {
      if (record[axis] === undefined) continue;
      if (typeof record[axis] !== "number") return null;
      message[axis] = record[axis];
    }
    if (record.clickCount !== undefined) {
      if (typeof record.clickCount !== "number") return null;
      message.clickCount = record.clickCount;
    }
    return isValidInputMessage(message) ? message : null;
  }

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
