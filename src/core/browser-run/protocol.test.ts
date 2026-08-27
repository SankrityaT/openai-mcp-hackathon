import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SCREENCAST,
  attachToTargetCommand,
  captureScreenshotCommand,
  createCdpEncoder,
  decodeCdpMessage,
  decodeUpstream,
  displayDomain,
  encodeCdpCommand,
  encodeDownstream,
  handleScreencastFrame,
  navigationMessage,
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
  // Input forwarding is not implemented, so input verbs must not decode.
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
