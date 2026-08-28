import assert from "node:assert/strict";
import test from "node:test";
import type { CdpTransport } from "../../core/browser-run/protocol";
import {
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_LOOKUP_ORIGIN,
  WebLookupAdapter,
  WebLookupFailedError,
  WebLookupInputError,
  readPageOverCdp,
  validateLookupUrl,
  type WebLookupDeps,
} from "./web-research";

/**
 * A scripted CDP peer. It speaks the real protocol (ids, results, events) but
 * touches no socket, no browser, and no Cloudflare account, so these tests
 * exercise the actual command sequence rather than a mock of it.
 */
type FakePageOptions = {
  title?: string;
  text?: string;
  finalUrl?: string;
  /** Emit no Page.loadEventFired, so the read has to hit its deadline. */
  neverLoads?: boolean;
  /** Return this as Page.navigate's errorText. */
  navigationError?: string;
  /** Reply to Runtime.evaluate with an exception instead of a value. */
  throwOnEvaluate?: boolean;
};

function fakeTransport(options: FakePageOptions = {}) {
  const sent: { method: string; params?: Record<string, unknown> }[] = [];
  let onMessage: ((raw: string) => void) | null = null;
  let closed = false;

  const reply = (payload: unknown) => {
    // Asynchronous, like a real socket: nothing may resolve inside `send`.
    setImmediate(() => {
      if (!closed) onMessage?.(JSON.stringify(payload));
    });
  };

  const transport: CdpTransport = {
    send(raw: string) {
      const command = JSON.parse(raw) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      };
      sent.push({ method: command.method, params: command.params });

      if (command.method === "Target.getTargets") {
        reply({ id: command.id, result: { targetInfos: [{ type: "page", targetId: "T1" }] } });
        return;
      }
      if (command.method === "Target.attachToTarget") {
        reply({ id: command.id, result: { sessionId: "S1" } });
        return;
      }
      if (command.method === "Page.enable" || command.method === "Runtime.enable") {
        reply({ id: command.id, result: {} });
        return;
      }
      if (command.method === "Page.navigate") {
        if (options.navigationError) {
          reply({ id: command.id, result: { errorText: options.navigationError } });
          return;
        }
        reply({ id: command.id, result: { frameId: "F1" } });
        if (!options.neverLoads) {
          reply({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" });
        }
        return;
      }
      if (command.method === "Runtime.evaluate") {
        if (options.throwOnEvaluate) {
          reply({
            id: command.id,
            result: { exceptionDetails: { text: "boom" }, result: { type: "undefined" } },
          });
          return;
        }
        reply({
          id: command.id,
          result: {
            result: {
              type: "object",
              value: {
                title: options.title ?? "Example Domain",
                url: options.finalUrl ?? "https://example.com/",
                text: options.text ?? "This domain is for use in documentation.",
              },
            },
          },
        });
        return;
      }
      reply({ id: command.id, result: {} });
    },
    close() {
      closed = true;
    },
    onMessage(handler) {
      onMessage = handler;
    },
    onClose() {},
    onError() {},
  };

  return { transport, sent, isClosed: () => closed };
}

function adapterWith(options: FakePageOptions = {}) {
  const closedSessions: string[] = [];
  const peer = fakeTransport(options);
  const deps: WebLookupDeps = {
    createSession: async () => ({
      sessionId: "cf-session-1",
      webSocketDebuggerUrl: "wss://browser.example/devtools/browser/abc",
    }),
    connect: async () => peer.transport,
    closeSession: async (sessionId) => {
      closedSessions.push(sessionId);
    },
  };
  return { adapter: new WebLookupAdapter({ deps }), closedSessions, peer };
}

const REQUEST = {
  capabilityId: WEB_LOOKUP_CAPABILITY_ID,
  missionId: "mission-1",
  correlationId: "11111111-1111-1111-1111-111111111111",
  idempotencyKey: "idem_web_lookup",
};

/* ---- discovery -------------------------------------------------------- */

test("discovery is gated on the remote browser being configured", async () => {
  const disabled = new WebLookupAdapter({ enabled: false });
  assert.deepEqual(await disabled.discover(), []);
});

test("the discovered capability is a derived, read-only, low-risk read", async () => {
  const capabilities = await new WebLookupAdapter({ enabled: true }).discover();
  assert.equal(capabilities.length, 1);
  const [capability] = capabilities;
  assert.equal(capability.id, WEB_LOOKUP_CAPABILITY_ID);
  assert.equal(capability.name, WEB_LOOKUP_CAPABILITY_ID);
  assert.equal(capability.provider, "cardea");
  assert.equal(capability.readOnly, true);
  assert.equal(capability.risk.level, "low");
  // "derived" is the descriptor, not the evidence: the navigate-and-read
  // function is Cardea's own. The evidence it returns is untrusted below.
  assert.equal(capability.trust.level, "derived");
  assert.equal(capability.trust.origin, WEB_LOOKUP_ORIGIN);
});

test("the planner-facing description says what it does and what to pass it", async () => {
  const [capability] = await new WebLookupAdapter({ enabled: true }).discover();
  assert.match(capability.description, /one public webpage/i);
  assert.match(capability.description, /remote browser/i);
  assert.match(capability.description, /url/i);
  assert.match(capability.description, /login/i);
});

/* ---- url validation --------------------------------------------------- */

test("a public https url is accepted", () => {
  assert.equal(validateLookupUrl("https://example.com/page?q=1").host, "example.com");
});

for (const rejected of [
  "http://localhost:3000/",
  "http://127.0.0.1/",
  "http://10.0.0.5/",
  "http://172.16.4.9/",
  "http://192.168.1.1/",
  "http://printer.local/",
  "http://box.internal/",
  "http://[::1]/",
  "http://2130706433/",
  "https://user:secret@example.com/",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,hi",
  "not a url",
  "",
]) {
  test(`validateLookupUrl rejects ${JSON.stringify(rejected)}`, () => {
    assert.throws(() => validateLookupUrl(rejected), WebLookupInputError);
  });
}

test("an over-long url is rejected before it is parsed", () => {
  assert.throws(
    () => validateLookupUrl(`https://example.com/${"a".repeat(4_000)}`),
    WebLookupInputError,
  );
});

test("a non-string url is rejected", () => {
  assert.throws(() => validateLookupUrl(42), WebLookupInputError);
  assert.throws(() => validateLookupUrl(null), WebLookupInputError);
});

/* ---- execution -------------------------------------------------------- */

test("a successful read returns the page's own title, url, excerpt, and session id", async () => {
  const { adapter, closedSessions, peer } = adapterWith();
  const result = await adapter.execute({ ...REQUEST, input: { url: "https://example.com/" } });

  assert.deepEqual(result.output, {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example Domain",
    excerpt: "This domain is for use in documentation.",
    sessionId: "cf-session-1",
  });
  assert.equal(result.summary, 'Read "Example Domain" at example.com');
  assert.equal(result.provenance, "browser-run://cloudflare/example.com");
  // Page text is never Cardea's own claim, however it was fetched.
  assert.equal(result.trust, "untrusted");
  assert.equal(result.executionId, REQUEST.idempotencyKey);

  assert.deepEqual(closedSessions, ["cf-session-1"], "the session is always closed");
  assert.equal(peer.isClosed(), true);
  assert.deepEqual(
    peer.sent.map((command) => command.method),
    [
      "Target.getTargets",
      "Target.attachToTarget",
      "Page.enable",
      "Runtime.enable",
      "Page.navigate",
      "Runtime.evaluate",
    ],
  );
});

test("a bare url string is accepted, because that is the shape a plan can carry", async () => {
  const { adapter } = adapterWith();
  const result = await adapter.execute({ ...REQUEST, input: "https://example.com/" });
  assert.equal(result.summary, 'Read "Example Domain" at example.com');
});

test("the excerpt is bounded and the whole payload stays under 6KB", async () => {
  const { adapter } = adapterWith({ text: "lorem ipsum ".repeat(5_000) });
  const result = await adapter.execute({ ...REQUEST, input: { url: "https://example.com/" } });
  const output = result.output as { excerpt: string };
  assert.ok(output.excerpt.length <= 4_000, "the excerpt is capped at 4000 characters");
  assert.ok(
    Buffer.byteLength(JSON.stringify(result.output), "utf8") <= 6_144,
    "the serialized payload stays under the 6KB bound",
  );
});

test("a rejected url never opens a session", async () => {
  const closedSessions: string[] = [];
  let created = 0;
  const adapter = new WebLookupAdapter({
    deps: {
      createSession: async () => {
        created += 1;
        return { sessionId: "never", webSocketDebuggerUrl: "wss://x/y" };
      },
      connect: async () => {
        throw new Error("must not connect");
      },
      closeSession: async (id) => {
        closedSessions.push(id);
      },
    },
  });
  await assert.rejects(
    () => adapter.execute({ ...REQUEST, input: { url: "http://localhost/" } }),
    WebLookupInputError,
  );
  assert.equal(created, 0);
  assert.deepEqual(closedSessions, []);
});

test("execute refuses a capability id that is not its own", async () => {
  const { adapter } = adapterWith();
  await assert.rejects(
    () => adapter.execute({ ...REQUEST, capabilityId: "cardea.something_else", input: "https://example.com/" }),
    WebLookupInputError,
  );
});

test("a navigation error propagates and still closes the session", async () => {
  const { adapter, closedSessions } = adapterWith({ navigationError: "net::ERR_NAME_NOT_RESOLVED" });
  await assert.rejects(
    () => adapter.execute({ ...REQUEST, input: { url: "https://example.invalid/" } }),
    (error: unknown) =>
      error instanceof WebLookupFailedError && /ERR_NAME_NOT_RESOLVED/.test(error.message),
  );
  assert.deepEqual(closedSessions, ["cf-session-1"]);
});

test("a page that never loads times out, and the timeout reaches the caller", async () => {
  const peer = fakeTransport({ neverLoads: true });
  await assert.rejects(
    () => readPageOverCdp(peer.transport, "https://example.com/", 40),
    (error: unknown) =>
      error instanceof WebLookupFailedError && /timed out after 40ms/.test(error.message),
  );
});

test("a timeout still closes the session rather than leaking it", async () => {
  const closedSessions: string[] = [];
  const peer = fakeTransport({ neverLoads: true });
  const adapter = new WebLookupAdapter({
    timeoutMs: 40,
    deps: {
      createSession: async () => ({ sessionId: "cf-leaky", webSocketDebuggerUrl: "wss://x/y" }),
      connect: async () => peer.transport,
      closeSession: async (id) => {
        closedSessions.push(id);
      },
    },
  });
  await assert.rejects(
    () => adapter.execute({ ...REQUEST, input: { url: "https://example.com/" } }),
    WebLookupFailedError,
  );
  assert.deepEqual(closedSessions, ["cf-leaky"]);
});

test("a page that throws during the read fails honestly instead of returning empty evidence", async () => {
  const { adapter } = adapterWith({ throwOnEvaluate: true });
  await assert.rejects(
    () => adapter.execute({ ...REQUEST, input: { url: "https://example.com/" } }),
    (error: unknown) =>
      error instanceof WebLookupFailedError && /no readable text/.test(error.message),
  );
});

test("a page with no title is summarized by its host, never by an invented title", async () => {
  const { adapter } = adapterWith({ title: "", finalUrl: "https://example.com/docs" });
  const result = await adapter.execute({ ...REQUEST, input: { url: "https://example.com/docs" } });
  assert.equal(result.summary, 'Read "example.com" at example.com');
});

test("a redirect is reported by its final url, not by the requested one", async () => {
  const { adapter } = adapterWith({ finalUrl: "https://www.example.org/landing", title: "Landed" });
  const result = await adapter.execute({ ...REQUEST, input: { url: "https://example.com/" } });
  const output = result.output as { url: string; finalUrl: string };
  assert.equal(output.url, "https://example.com/");
  assert.equal(output.finalUrl, "https://www.example.org/landing");
  assert.equal(result.provenance, "browser-run://cloudflare/www.example.org");
});
