import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REMOTE_VIEWPORT,
  DEFAULT_SCREENCAST,
  INPUT_MODIFIER,
  INPUT_ROUND_TRIP_BUDGET_MS,
  INPUT_VERIFY_TIMEOUT_MS,
  MAX_INPUT_MODIFIERS,
  MAX_INPUT_TEXT_LENGTH,
  MAX_SEARCH_LINKS,
  MAX_SEARCH_LINK_TEXT_CHARS,
  REMOTE_BROWSER_ACCEPT_LANGUAGE,
  REMOTE_BROWSER_USER_AGENT,
  userAgentOverrideCommand,
  SEARCH_RESULT_LINKS_EXPRESSION,
  SEARCH_RESULT_SELECTORS,
  readSearchLinksEvaluation,
  type InputMessage,
  attachToTargetCommand,
  captureScreenshotCommand,
  createCdpEncoder,
  decodeCdpMessage,
  decodeUpstream,
  displayDomain,
  encodeCdpCommand,
  encodeDownstream,
  handleScreencastFrame,
  inputCommand,
  inputVerificationProbe,
  isInputMessage,
  isValidInputMessage,
  MAX_PAGE_RATINGS,
  navigationMessage,
  readPageEvaluation,
  scaleNormalisedPoint,
  redactDevtoolsUrl,
  startScreencastCommand,
  statusMessage,
  stopScreencastCommand,
  validateTargetUrl,
} from "./protocol";

function event(method: string, params: Record<string, unknown>, sessionId?: string) {
  const decoded = decodeCdpMessage(JSON.stringify({ method, params, sessionId }));
  assert.ok(decoded && decoded.kind === "event");
  return decoded;
}

test("CDP command ids increment monotonically and never repeat", () => {
  const encoder = createCdpEncoder();
  const ids = [
    encoder.command("Page.enable").id,
    encoder.command("Page.navigate", { url: "https://example.com" }).id,
    encoder.command("Page.enable", undefined, "S1").id,
  ];
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(encoder.lastId(), 3);
});

test("browser-level commands omit sessionId, page-level commands carry it", () => {
  const encoder = createCdpEncoder();
  const browserLevel = encoder.command("Target.getTargets");
  assert.equal("sessionId" in browserLevel, false);
  assert.equal("params" in browserLevel, false);

  const pageLevel = encoder.command("Page.navigate", { url: "https://example.com" }, "SESSION-1");
  assert.equal(pageLevel.sessionId, "SESSION-1");
  assert.deepEqual(JSON.parse(encodeCdpCommand(pageLevel)), {
    id: 2,
    method: "Page.navigate",
    params: { url: "https://example.com" },
    sessionId: "SESSION-1",
  });
});

test("attachToTarget always requests flat mode", () => {
  const encoder = createCdpEncoder();
  const command = attachToTargetCommand(encoder, "TARGET-9");
  assert.equal(command.method, "Target.attachToTarget");
  assert.deepEqual(command.params, { targetId: "TARGET-9", flatten: true });
  assert.equal(command.sessionId, undefined);
});

test("screencast start, stop, and screenshot commands are session scoped", () => {
  const encoder = createCdpEncoder();
  const start = startScreencastCommand(encoder, "S");
  assert.deepEqual(start.params, { ...DEFAULT_SCREENCAST });
  assert.equal(start.sessionId, "S");

  const stop = stopScreencastCommand(encoder, "S");
  assert.equal(stop.method, "Page.stopScreencast");
  assert.equal(stop.params, undefined);
  assert.equal(stop.sessionId, "S");

  const shot = captureScreenshotCommand(encoder, "S");
  assert.equal(shot.method, "Page.captureScreenshot");
  assert.deepEqual(shot.params, { format: "jpeg", quality: 60, captureBeyondViewport: false });
  assert.equal(shot.sessionId, "S");
});

test("decodeCdpMessage distinguishes results, errors, and events", () => {
  assert.deepEqual(decodeCdpMessage(JSON.stringify({ id: 4, result: { sessionId: "S" } })), {
    kind: "result",
    id: 4,
    result: { sessionId: "S" },
  });
  assert.deepEqual(
    decodeCdpMessage(JSON.stringify({ id: 5, error: { code: -32000, message: "no target" } })),
    { kind: "error", id: 5, code: -32000, message: "no target" },
  );
  assert.deepEqual(decodeCdpMessage(JSON.stringify({ method: "Page.loadEventFired", params: {} })), {
    kind: "event",
    method: "Page.loadEventFired",
    params: {},
  });
});

test("decodeCdpMessage returns null instead of throwing on junk", () => {
  assert.equal(decodeCdpMessage("not json"), null);
  assert.equal(decodeCdpMessage("null"), null);
  assert.equal(decodeCdpMessage("[1,2,3]"), null);
  assert.equal(decodeCdpMessage(JSON.stringify({ nothing: true })), null);
});

test("a result with no result body still decodes to an empty object", () => {
  assert.deepEqual(decodeCdpMessage(JSON.stringify({ id: 7 })), { kind: "result", id: 7, result: {} });
});

test("every screencast frame produces an ack scoped to the same target session", () => {
  const encoder = createCdpEncoder();
  const outcome = handleScreencastFrame(
    encoder,
    event(
      "Page.screencastFrame",
      { data: "AAAA", sessionId: 12, metadata: { deviceWidth: 800, deviceHeight: 480 } },
      "TARGET-SESSION",
    ),
    3,
  );
  assert.ok(outcome);
  // The ack carries the *frame* session id in params and the *target* session
  // id in the envelope. Swapping them silently freezes the stream.
  assert.equal(outcome.ack.method, "Page.screencastFrameAck");
  assert.deepEqual(outcome.ack.params, { sessionId: 12 });
  assert.equal(outcome.ack.sessionId, "TARGET-SESSION");
  assert.deepEqual(outcome.frame, { t: "frame", data: "AAAA", w: 800, h: 480, seq: 3 });
});

test("frame dimensions fall back to the configured maximums when metadata is absent", () => {
  const encoder = createCdpEncoder();
  const outcome = handleScreencastFrame(
    encoder,
    event("Page.screencastFrame", { data: "BBBB", sessionId: 1 }, "S"),
    0,
  );
  assert.ok(outcome);
  assert.equal(outcome.frame.w, DEFAULT_SCREENCAST.maxWidth);
  assert.equal(outcome.frame.h, DEFAULT_SCREENCAST.maxHeight);
});

test("a payloadless or foreign event yields no frame and no ack", () => {
  const encoder = createCdpEncoder();
  assert.equal(
    handleScreencastFrame(encoder, event("Page.screencastFrame", { sessionId: 1 }, "S"), 0),
    null,
  );
  assert.equal(
    handleScreencastFrame(encoder, event("Page.screencastFrame", { data: "", sessionId: 1 }, "S"), 0),
    null,
  );
  assert.equal(
    handleScreencastFrame(encoder, event("Page.screencastFrame", { data: "AA" }, "S"), 0),
    null,
  );
  assert.equal(handleScreencastFrame(encoder, event("Page.loadEventFired", {}, "S"), 0), null);
  // No id was consumed by any of the rejected events.
  assert.equal(encoder.lastId(), 0);
});

test("only main frame navigations become nav messages", () => {
  assert.deepEqual(
    navigationMessage(event("Page.frameNavigated", { frame: { id: "F", url: "https://a.test/x" } })),
    { t: "nav", url: "https://a.test/x" },
  );
  assert.equal(
    navigationMessage(
      event("Page.frameNavigated", { frame: { id: "F2", parentId: "F", url: "https://ads.test" } }),
    ),
    null,
  );
  assert.equal(navigationMessage(event("Page.frameNavigated", { frame: {} })), null);
  assert.equal(navigationMessage(event("Page.loadEventFired", {})), null);
});

test("downstream encoding keeps the tagged union shape and omits absent details", () => {
  assert.equal(
    encodeDownstream(statusMessage("streaming")),
    JSON.stringify({ t: "status", state: "streaming" }),
  );
  assert.equal(
    encodeDownstream(statusMessage("error", "at capacity")),
    JSON.stringify({ t: "status", state: "error", detail: "at capacity" }),
  );
  assert.equal(
    encodeDownstream({ t: "frame", data: "Zm9v", w: 1024, h: 640, seq: 11 }),
    JSON.stringify({ t: "frame", data: "Zm9v", w: 1024, h: 640, seq: 11 }),
  );
});

test("upstream control messages accept only the three known verbs", () => {
  assert.deepEqual(decodeUpstream(JSON.stringify({ t: "pause" })), { t: "pause" });
  assert.deepEqual(decodeUpstream(JSON.stringify({ t: "resume" })), { t: "resume" });
  assert.deepEqual(decodeUpstream(JSON.stringify({ t: "refresh" })), { t: "refresh" });
  // "click" is not part of the input protocol; only mouse, key, and insert are.
  assert.equal(decodeUpstream(JSON.stringify({ t: "click", x: 1, y: 2 })), null);
  assert.equal(decodeUpstream("{"), null);
  assert.equal(decodeUpstream("42"), null);
});

test("only bounded http(s) URLs reach a real browser", () => {
  assert.equal(validateTargetUrl("https://example.com/a?b=c")?.href, "https://example.com/a?b=c");
  assert.equal(validateTargetUrl("  http://localhost:3000/x  ")?.protocol, "http:");
  assert.equal(validateTargetUrl("javascript:alert(1)"), null);
  assert.equal(validateTargetUrl("data:text/html,<b>x</b>"), null);
  assert.equal(validateTargetUrl("file:///etc/passwd"), null);
  assert.equal(validateTargetUrl("not a url"), null);
  assert.equal(validateTargetUrl(""), null);
  assert.equal(validateTargetUrl(null), null);
  assert.equal(validateTargetUrl(`https://example.com/${"a".repeat(2100)}`), null);
});

test("the address line shows a bare domain, never a full URL", () => {
  assert.equal(displayDomain("https://www.shopify.com/admin/orders?page=2"), "shopify.com");
  assert.equal(displayDomain("http://localhost:3000/app"), "localhost");
  assert.equal(displayDomain("javascript:alert(1)"), "unknown");
});

test("devtools URLs are redacted before they can reach a log or an error", () => {
  assert.equal(
    redactDevtoolsUrl(
      "wss://api.cloudflare.com/client/v4/accounts/abc123/browser-rendering/devtools/browser?keep_alive=600000",
    ),
    "wss://api.cloudflare.com/client/v4/accounts/<redacted>/browser-rendering/devtools/browser",
  );
  assert.equal(redactDevtoolsUrl("garbage"), "<redacted devtools url>");
});

/* ---- Input forwarding ------------------------------------------------- */

function inputParams(message: InputMessage, viewport = DEFAULT_REMOTE_VIEWPORT) {
  const command = inputCommand(createCdpEncoder(), "SESSION-1", message, viewport);
  assert.ok(command, `expected a command for ${JSON.stringify(message)}`);
  assert.equal(command.sessionId, "SESSION-1");
  return { method: command.method, params: command.params as Record<string, unknown> };
}

test("normalised points scale onto the remote viewport and clamp to the last pixel", () => {
  assert.deepEqual(scaleNormalisedPoint(0, 0, { width: 1024, height: 640 }), { x: 0, y: 0 });
  assert.deepEqual(scaleNormalisedPoint(0.5, 0.5, { width: 1024, height: 640 }), { x: 512, y: 320 });
  // 1.0 is "the last painted column", not one column past it.
  assert.deepEqual(scaleNormalisedPoint(1, 1, { width: 1024, height: 640 }), { x: 1023, y: 639 });
  assert.deepEqual(scaleNormalisedPoint(0.25, 0.75, { width: 800, height: 600 }), {
    x: 200,
    y: 450,
  });
  const odd = scaleNormalisedPoint(0.3333, 0.6667, { width: 999, height: 333 });
  assert.equal(Number.isInteger(odd.x) && Number.isInteger(odd.y), true);
});

test("the client canvas size never reaches the wire: only the viewport scales", () => {
  // One normalised point, two remote viewports, two different device pixels.
  const small = inputParams({ t: "mouse", kind: "move", x: 0.5, y: 0.5 }, { width: 320, height: 200 });
  const large = inputParams({ t: "mouse", kind: "move", x: 0.5, y: 0.5 }, { width: 1024, height: 640 });
  assert.deepEqual([small.params.x, small.params.y], [160, 100]);
  assert.deepEqual([large.params.x, large.params.y], [512, 320]);
});

test("every mouse kind maps to its CDP dispatch type", () => {
  assert.equal(inputParams({ t: "mouse", kind: "move", x: 0, y: 0 }).params.type, "mouseMoved");
  assert.equal(inputParams({ t: "mouse", kind: "down", x: 0, y: 0 }).params.type, "mousePressed");
  assert.equal(inputParams({ t: "mouse", kind: "up", x: 0, y: 0 }).params.type, "mouseReleased");
  assert.equal(inputParams({ t: "mouse", kind: "wheel", x: 0, y: 0 }).params.type, "mouseWheel");
  for (const kind of ["move", "down", "up", "wheel"] as const) {
    assert.equal(inputParams({ t: "mouse", kind, x: 0, y: 0 }).method, "Input.dispatchMouseEvent");
  }
});

test("press sets the held-button bitmask, release clears it, move and wheel hold nothing", () => {
  const left = inputParams({ t: "mouse", kind: "down", x: 0.1, y: 0.1 });
  assert.equal(left.params.button, "left");
  assert.equal(left.params.buttons, 1);
  assert.equal(left.params.clickCount, 1);

  const right = inputParams({ t: "mouse", kind: "down", x: 0.1, y: 0.1, button: "right" });
  assert.equal(right.params.buttons, 2);
  const middle = inputParams({ t: "mouse", kind: "down", x: 0.1, y: 0.1, button: "middle" });
  assert.equal(middle.params.buttons, 4);

  const release = inputParams({ t: "mouse", kind: "up", x: 0.1, y: 0.1, button: "right" });
  assert.equal(release.params.button, "right");
  assert.equal(release.params.buttons, 0);

  for (const kind of ["move", "wheel"] as const) {
    const moved = inputParams({ t: "mouse", kind, x: 0.1, y: 0.1 });
    assert.equal(moved.params.button, "none");
    assert.equal(moved.params.buttons, 0);
    assert.equal("clickCount" in moved.params, false);
  }
});

test("clickCount survives so a double click stays a double click", () => {
  const doubled = inputParams({ t: "mouse", kind: "down", x: 0.5, y: 0.5, clickCount: 2 });
  assert.equal(doubled.params.clickCount, 2);
});

test("wheel deltas ride along and default to zero", () => {
  const scrolled = inputParams({
    t: "mouse",
    kind: "wheel",
    x: 0.5,
    y: 0.5,
    deltaX: -12,
    deltaY: 240,
  });
  assert.equal(scrolled.params.deltaX, -12);
  assert.equal(scrolled.params.deltaY, 240);
  const bare = inputParams({ t: "mouse", kind: "wheel", x: 0.5, y: 0.5 });
  assert.deepEqual([bare.params.deltaX, bare.params.deltaY], [0, 0]);
  // Deltas exist only on wheel events.
  assert.equal("deltaY" in inputParams({ t: "mouse", kind: "move", x: 0, y: 0 }).params, false);
});

test("key down and key up map to keyDown and keyUp with key, code, and modifiers", () => {
  const down = inputParams({ t: "key", kind: "down", key: "a", code: "KeyA" });
  assert.equal(down.method, "Input.dispatchKeyEvent");
  assert.deepEqual(down.params, { type: "keyDown", key: "a", code: "KeyA", modifiers: 0 });

  const up = inputParams({ t: "key", kind: "up", key: "Enter", code: "Enter" });
  assert.equal(up.params.type, "keyUp");

  // A keyDown may carry text, which is CDP's char path for one character.
  const typed = inputParams({ t: "key", kind: "down", key: "A", code: "KeyA", text: "A" });
  assert.equal(typed.params.text, "A");
  // A keyDown without text carries no text key at all, so nothing inserts twice.
  assert.equal("text" in down.params, false);
});

test("the modifier bitmask is CDP's, not the DOM's", () => {
  assert.deepEqual(INPUT_MODIFIER, { alt: 1, ctrl: 2, meta: 4, shift: 8 });
  assert.equal(MAX_INPUT_MODIFIERS, 15);
  const shifted = inputParams({
    t: "key",
    kind: "down",
    key: "A",
    code: "KeyA",
    modifiers: INPUT_MODIFIER.shift | INPUT_MODIFIER.meta,
  });
  assert.equal(shifted.params.modifiers, 12);
});

test("insert maps to Input.insertText and never to a synthetic keypress", () => {
  const inserted = inputParams({ t: "insert", text: "hello world" });
  assert.equal(inserted.method, "Input.insertText");
  assert.deepEqual(inserted.params, { text: "hello world" });
});

test("input bounds are refused rather than clamped", () => {
  const encoder = createCdpEncoder();
  const refuse = (message: InputMessage) => {
    assert.equal(isValidInputMessage(message), false, JSON.stringify(message));
    assert.equal(inputCommand(encoder, "S1", message), null, JSON.stringify(message));
  };

  // Coordinates must be finite and normalised, because they reach a real browser.
  refuse({ t: "mouse", kind: "move", x: 1.0001, y: 0.5 });
  refuse({ t: "mouse", kind: "move", x: -0.0001, y: 0.5 });
  refuse({ t: "mouse", kind: "move", x: Number.NaN, y: 0.5 });
  refuse({ t: "mouse", kind: "move", x: Number.POSITIVE_INFINITY, y: 0.5 });
  // Device pixels are exactly what the client must not send.
  refuse({ t: "mouse", kind: "move", x: 512, y: 320 });
  // Unknown kinds stay rejected even under a known tag.
  refuse({ t: "mouse", kind: "drag" as "move", x: 0.5, y: 0.5 });
  refuse({ t: "key", kind: "press" as "down", key: "a", code: "KeyA" });
  refuse({ t: "mouse", kind: "down", x: 0.5, y: 0.5, button: "back" as "left" });
  refuse({ t: "mouse", kind: "down", x: 0.5, y: 0.5, clickCount: 4 });
  refuse({ t: "mouse", kind: "down", x: 0.5, y: 0.5, clickCount: 1.5 });
  refuse({ t: "mouse", kind: "wheel", x: 0.5, y: 0.5, deltaY: 10_001 });
  refuse({ t: "mouse", kind: "wheel", x: 0.5, y: 0.5, deltaX: Number.NaN });
  refuse({ t: "key", kind: "down", key: "", code: "KeyA" });
  refuse({ t: "key", kind: "down", key: "k".repeat(65), code: "KeyA" });
  refuse({ t: "key", kind: "down", key: "a", code: "KeyA", modifiers: 16 });
  refuse({ t: "key", kind: "down", key: "a", code: "KeyA", modifiers: -1 });
  refuse({ t: "insert", text: "" });
  refuse({ t: "insert", text: "x".repeat(MAX_INPUT_TEXT_LENGTH + 1) });

  // Exactly at the bound is allowed; one over is not.
  assert.equal(isValidInputMessage({ t: "insert", text: "x".repeat(MAX_INPUT_TEXT_LENGTH) }), true);
  assert.equal(isValidInputMessage({ t: "mouse", kind: "wheel", x: 1, y: 1, deltaY: 10_000 }), true);
  assert.equal(
    isValidInputMessage({ t: "key", kind: "down", key: "a", code: "KeyA", modifiers: 15 }),
    true,
  );
});

test("decodeUpstream accepts every input message and rejects malformed ones", () => {
  assert.deepEqual(decodeUpstream(JSON.stringify({ t: "mouse", kind: "move", x: 0.5, y: 0.5 })), {
    t: "mouse",
    kind: "move",
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(
    decodeUpstream(
      JSON.stringify({ t: "mouse", kind: "down", x: 0, y: 1, button: "right", clickCount: 2 }),
    ),
    { t: "mouse", kind: "down", x: 0, y: 1, button: "right", clickCount: 2 },
  );
  assert.deepEqual(
    decodeUpstream(JSON.stringify({ t: "mouse", kind: "wheel", x: 0.2, y: 0.2, deltaY: -40 })),
    { t: "mouse", kind: "wheel", x: 0.2, y: 0.2, deltaY: -40 },
  );
  assert.deepEqual(
    decodeUpstream(JSON.stringify({ t: "key", kind: "up", key: "Tab", code: "Tab", modifiers: 8 })),
    { t: "key", kind: "up", key: "Tab", code: "Tab", modifiers: 8 },
  );
  assert.deepEqual(decodeUpstream(JSON.stringify({ t: "insert", text: "hi" })), {
    t: "insert",
    text: "hi",
  });

  // Unknown kinds, wrong types, and out-of-bounds values all resolve to null.
  assert.equal(decodeUpstream(JSON.stringify({ t: "mouse", kind: "hover", x: 0.5, y: 0.5 })), null);
  assert.equal(decodeUpstream(JSON.stringify({ t: "mouse", kind: "move", x: "0.5", y: 0.5 })), null);
  assert.equal(decodeUpstream(JSON.stringify({ t: "mouse", kind: "move", x: 4, y: 0.5 })), null);
  assert.equal(decodeUpstream(JSON.stringify({ t: "key", kind: "down" })), null);
  assert.equal(
    decodeUpstream(JSON.stringify({ t: "key", kind: "chord", key: "a", code: "KeyA" })),
    null,
  );
  assert.equal(decodeUpstream(JSON.stringify({ t: "insert", text: 7 })), null);
  assert.equal(decodeUpstream(JSON.stringify({ t: "insert" })), null);
});

test("decodeUpstream copies fields rather than spreading, so extra keys cannot ride along", () => {
  const decoded = decodeUpstream(
    JSON.stringify({ t: "mouse", kind: "move", x: 0.5, y: 0.5, interceptDrags: true }),
  );
  assert.deepEqual(decoded, { t: "mouse", kind: "move", x: 0.5, y: 0.5 });
  const command = inputCommand(createCdpEncoder(), "S1", decoded as InputMessage);
  assert.deepEqual(Object.keys(command?.params ?? {}).sort(), [
    "button",
    "buttons",
    "modifiers",
    "type",
    "x",
    "y",
  ]);
});

test("isInputMessage separates the input half of the upstream union", () => {
  assert.equal(isInputMessage({ t: "pause" }), false);
  assert.equal(isInputMessage({ t: "resume" }), false);
  assert.equal(isInputMessage({ t: "refresh" }), false);
  assert.equal(isInputMessage({ t: "mouse", kind: "move", x: 0, y: 0 }), true);
  assert.equal(isInputMessage({ t: "key", kind: "down", key: "a", code: "KeyA" }), true);
  assert.equal(isInputMessage({ t: "insert", text: "a" }), true);
});

test("the verification probe cannot click, type, or scroll anything", () => {
  const probe = inputVerificationProbe();
  assert.deepEqual(probe, { t: "mouse", kind: "move", x: 0.5, y: 0.5 });
  const { params } = inputParams(probe);
  assert.equal(params.type, "mouseMoved");
  assert.equal(params.button, "none");
  assert.equal(params.buttons, 0);
  assert.equal("deltaY" in params, false);
  assert.equal("clickCount" in params, false);
});

test("the round trip budget is a judgement aid and the verify timeout outlives it", () => {
  assert.equal(INPUT_ROUND_TRIP_BUDGET_MS, 800);
  assert.equal(INPUT_VERIFY_TIMEOUT_MS, 1_500);
  // A slow round trip is a quality signal; a missing one is a correctness signal.
  assert.ok(INPUT_VERIFY_TIMEOUT_MS > INPUT_ROUND_TRIP_BUDGET_MS);
});

test("interactive is a downstream status like any other and encodes with its detail", () => {
  assert.equal(
    encodeDownstream(statusMessage("interactive", "round trip 143ms, budget 800ms")),
    JSON.stringify({ t: "status", state: "interactive", detail: "round trip 143ms, budget 800ms" }),
  );
  assert.equal(
    encodeDownstream(statusMessage("streaming", "input_unverified")),
    JSON.stringify({ t: "status", state: "streaming", detail: "input_unverified" }),
  );
});

/* ---- user agent override ----------------------------------------------- */

test("the override presents a real desktop Chrome, never a headless token", () => {
  const encoder = createCdpEncoder();
  const command = userAgentOverrideCommand(encoder, "S1");
  assert.equal(command.method, "Emulation.setUserAgentOverride");
  assert.equal(command.sessionId, "S1");
  assert.equal(command.params?.userAgent, REMOTE_BROWSER_USER_AGENT);
  assert.equal(command.params?.acceptLanguage, REMOTE_BROWSER_ACCEPT_LANGUAGE);
  // The whole point: sites serve stripped or empty documents to HeadlessChrome.
  assert.ok(!REMOTE_BROWSER_USER_AGENT.includes("Headless"));
  assert.match(REMOTE_BROWSER_USER_AGENT, /^Mozilla\/5\.0 /);
  assert.match(REMOTE_BROWSER_USER_AGENT, /Chrome\/\d+/);
});

/* ---- search result extraction ----------------------------------------- */

function evaluateReply(value: unknown) {
  return { result: { type: "object", value } };
}

test("the link expression tries result anchors first and sweeps broadly last", () => {
  // Order is the contract: the precise result-title selector must be tried
  // before the sweep, or a results page's chrome outranks its results.
  assert.equal(SEARCH_RESULT_SELECTORS[0], "a.result__a");
  assert.equal(SEARCH_RESULT_SELECTORS[SEARCH_RESULT_SELECTORS.length - 1], "a[href]");
  assert.ok(SEARCH_RESULT_SELECTORS.includes('a[data-matarget="algo"]'));
  // The list is embedded in the expression as a JS array literal, so the
  // escaped form is what has to be there, quotes and order included.
  assert.ok(SEARCH_RESULT_LINKS_EXPRESSION.includes(JSON.stringify(SEARCH_RESULT_SELECTORS)));
});

test("the link expression bounds what it returns inside the page", () => {
  // The expression is a string handed to a page, so its bounds are asserted
  // where they are written, not only where they are re-applied afterwards.
  assert.match(SEARCH_RESULT_LINKS_EXPRESSION, /anchor\.href/);
  assert.ok(SEARCH_RESULT_LINKS_EXPRESSION.includes(String(MAX_SEARCH_LINKS)));
  assert.ok(SEARCH_RESULT_LINKS_EXPRESSION.includes(String(MAX_SEARCH_LINK_TEXT_CHARS)));
});

test("a search evaluation reads the anchors the page offered", () => {
  const anchors = readSearchLinksEvaluation(
    evaluateReply({
      url: "https://html.duckduckgo.com/html/?q=pizza",
      links: [
        { href: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F", text: "A" },
        { href: "https://b.example/", text: "B" },
      ],
    }),
  );
  assert.deepEqual(anchors, [
    { href: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F", text: "A" },
    { href: "https://b.example/", text: "B" },
  ]);
});

test("a results page with no results reads as an empty list, not as unreadable", () => {
  assert.deepEqual(readSearchLinksEvaluation(evaluateReply({ url: "https://x/", links: [] })), []);
});

test("a page that threw, or answered in an unknown shape, reads as null", () => {
  assert.equal(readSearchLinksEvaluation({ exceptionDetails: { text: "boom" } }), null);
  assert.equal(readSearchLinksEvaluation({}), null);
  assert.equal(readSearchLinksEvaluation(evaluateReply({ url: "https://x/" })), null);
  assert.equal(readSearchLinksEvaluation(evaluateReply(null)), null);
  assert.equal(readSearchLinksEvaluation(evaluateReply({ links: "not an array" })), null);
});

test("link bounds are re-applied to whatever the page actually returned", () => {
  const anchors = readSearchLinksEvaluation(
    evaluateReply({
      url: "https://x/",
      links: Array.from({ length: 40 }, (_, index) => ({
        href: `https://host-${index}.example/`,
        text: "x".repeat(500),
      })),
    }),
  );
  assert.equal(anchors?.length, MAX_SEARCH_LINKS);
  for (const anchor of anchors ?? []) {
    assert.equal(anchor.text.length, MAX_SEARCH_LINK_TEXT_CHARS);
  }
});

test("an unbounded or missing href is dropped rather than shipped onward", () => {
  const anchors = readSearchLinksEvaluation(
    evaluateReply({
      url: "https://x/",
      links: [
        { href: "", text: "empty" },
        { href: `https://x.example/${"a".repeat(3_000)}`, text: "too long" },
        { text: "no href at all" },
        "not an object",
        null,
        { href: "https://kept.example/", text: "kept" },
      ],
    }),
  );
  assert.deepEqual(anchors, [{ href: "https://kept.example/", text: "kept" }]);
});

/* ======================================================================== *
 * readPageEvaluation: prices and ratings, parsed and bounded
 * ======================================================================== */

function evaluateResult(value: Record<string, unknown>) {
  return { result: { type: "object", value } };
}

test("prices and ratings both parse through, bounded and shape-checked", () => {
  const read = readPageEvaluation(
    evaluateResult({
      url: "https://example.com/product",
      title: "Example Product",
      text: "great buy",
      prices: ["$59.00", "not-a-price", 42, "$249.00"],
      ratings: ["4.9/5", "20,683 reviews", "not-a-rating", 42],
    }),
  );
  assert.ok(read);
  // Real tokens actually observed live against thuma.co's product page,
  // not invented: an overall score ("4.9/5") and a review count
  // ("20,683 reviews"), same shape a page like that renders in production.
  assert.deepEqual(read!.prices, ["$59.00", "$249.00"]);
  assert.deepEqual(read!.ratings, ["4.9/5", "20,683 reviews"]);
});

test("ratings capped at MAX_PAGE_RATINGS and each token capped at 32 chars", () => {
  const many = Array.from({ length: MAX_PAGE_RATINGS + 5 }, (_, i) => `${i}.0/5 padded well past the cap`);
  const read = readPageEvaluation(
    evaluateResult({ url: "https://example.com/", title: "T", text: "x", prices: [], ratings: many }),
  );
  assert.ok(read);
  assert.equal(read!.ratings.length, MAX_PAGE_RATINGS);
  assert.ok(read!.ratings.every((token) => token.length <= 32));
});

test("a missing ratings field degrades to an empty array, not a crash", () => {
  const read = readPageEvaluation(
    evaluateResult({ url: "https://example.com/", title: "T", text: "x", prices: [] }),
  );
  assert.ok(read);
  assert.deepEqual(read!.ratings, []);
});
