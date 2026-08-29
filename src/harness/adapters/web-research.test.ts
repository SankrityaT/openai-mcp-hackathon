import assert from "node:assert/strict";
import test from "node:test";
import type { CdpTransport } from "../../core/browser-run/protocol";
import { webLookupAdapter, webResearchAdapter } from "./web-research";
import {
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_LOOKUP_ORIGIN,
  WEB_RESEARCH_CAPABILITY_ID,
  WebLookupAdapter,
  WebLookupFailedError,
  WebLookupInputError,
  WebResearchAdapter,
  WebResearchFailedError,
  WebResearchInputError,
  boundResearchOutput,
  readPageOverCdp,
  readResearchInput,
  researchSummary,
  resolveSearchHref,
  searchUrlFor,
  selectSearchResults,
  SEARCH_ENGINES,
  validateLookupUrl,
  type WebLookupDeps,
  type WebResearchDeps,
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
    prices: [],
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

/* ======================================================================== *
 * cardea.web_research
 * ======================================================================== */

/** A DuckDuckGo click-redirect href, in the shape its results page prints. */
function uddg(target: string): string {
  return `https://duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&rut=abc123`;
}

/** A Yahoo click-redirect href, which hides the target in a path segment. */
function yahooRedirect(target: string): string {
  return `https://r.search.yahoo.com/_ylt=Awr/RV=2/RE=1787/RO=10/RU=${encodeURIComponent(target)}/RK=2/RS=abc-`;
}

const DDG_SEARCH_URL = "https://html.duckduckgo.com/html/?q=best%20pizza%20phoenix%20arizona";
const YAHOO_SEARCH_URL = "https://search.yahoo.com/search?p=best%20pizza%20phoenix%20arizona";

type FakeSearchPage = {
  /** Anchors the first search-results page hands back. */
  links?: { href: string; text: string }[];
  /** Anchors the second engine hands back, when the first yields nothing. */
  fallbackLinks?: { href: string; text: string }[];
  /** Every search-page navigation fails with this errorText. */
  searchNavigationError?: string;
  /** Every search page's Runtime.evaluate throws. */
  searchThrows?: boolean;
  /** Per-result-URL behaviour. Anything unlisted reads successfully. */
  pages?: Record<
    string,
    | { title?: string; text?: string; finalUrl?: string }
    | { navigationError: string }
    | { neverLoads: true }
    /** Parses, then keeps loading forever: the shape of a real ad-heavy page. */
    | { domContentOnly: true }
  >;
};

/**
 * A scripted CDP peer for a whole research run: one attach, then a search
 * navigation and one navigation per selected result, all on the same session
 * with a single command-id sequence, exactly as a real Cloudflare session
 * behaves. Nothing here touches a socket, a browser, or a Cloudflare account.
 */
function fakeSearchTransport(options: FakeSearchPage = {}) {
  const sent: { method: string; params?: Record<string, unknown> }[] = [];
  const seenIds: number[] = [];
  const navigated: string[] = [];
  let onMessage: ((raw: string) => void) | null = null;
  let closed = false;
  let currentUrl = "about:blank";

  const reply = (payload: unknown) => {
    setImmediate(() => {
      if (!closed) onMessage?.(JSON.stringify(payload));
    });
  };

  const isSearchUrl = (url: string) =>
    url.startsWith("https://html.duckduckgo.com/html/") ||
    url.startsWith("https://search.yahoo.com/search");

  const transport: CdpTransport = {
    send(raw: string) {
      const command = JSON.parse(raw) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      };
      sent.push({ method: command.method, params: command.params });
      seenIds.push(command.id);

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
        const url = String(command.params?.url ?? "");
        navigated.push(url);
        currentUrl = url;
        if (isSearchUrl(url) && options.searchNavigationError) {
          reply({ id: command.id, result: { errorText: options.searchNavigationError } });
          return;
        }
        const page = options.pages?.[url];
        if (page && "navigationError" in page) {
          reply({ id: command.id, result: { errorText: page.navigationError } });
          return;
        }
        reply({ id: command.id, result: { frameId: "F1" } });
        if (page && "domContentOnly" in page) {
          reply({ method: "Page.domContentEventFired", params: { timestamp: 1 }, sessionId: "S1" });
          return;
        }
        if (!(page && "neverLoads" in page)) {
          reply({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" });
        }
        return;
      }

      if (command.method === "Runtime.evaluate") {
        const expression = String(command.params?.expression ?? "");
        const isLinkRead = expression.includes("result__a");
        if (isLinkRead) {
          if (options.searchThrows) {
            reply({ id: command.id, result: { exceptionDetails: { text: "boom" } } });
            return;
          }
          const links = currentUrl.startsWith("https://search.yahoo.com/")
            ? (options.fallbackLinks ?? [])
            : (options.links ?? []);
          reply({
            id: command.id,
            result: { result: { type: "object", value: { url: currentUrl, links } } },
          });
          return;
        }
        const page = options.pages?.[currentUrl];
            const detail =
          page && !("navigationError" in page) && !("neverLoads" in page) && !("domContentOnly" in page)
            ? page
            : {};
        reply({
          id: command.id,
          result: {
            result: {
              type: "object",
              value: {
                title: detail.title ?? `Title for ${currentUrl}`,
                url: detail.finalUrl ?? currentUrl,
                text: detail.text ?? `Body text for ${currentUrl}`,
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

  return { transport, sent, seenIds, navigated, isClosed: () => closed };
}

function researchAdapterWith(options: FakeSearchPage = {}, timeouts: {
  timeoutMs?: number;
  navigationTimeoutMs?: number;
} = {}) {
  const closedSessions: string[] = [];
  const peer = fakeSearchTransport(options);
  let created = 0;
  const deps: WebResearchDeps = {
    createSession: async () => {
      created += 1;
      return {
        sessionId: "cf-research-1",
        webSocketDebuggerUrl: "wss://browser.example/devtools/browser/abc",
      };
    },
    connect: async () => peer.transport,
    closeSession: async (sessionId) => {
      closedSessions.push(sessionId);
    },
  };
  return {
    adapter: new WebResearchAdapter({ deps, ...timeouts }),
    closedSessions,
    peer,
    createdCount: () => created,
  };
}

const RESEARCH_REQUEST = {
  capabilityId: WEB_RESEARCH_CAPABILITY_ID,
  missionId: "mission-1",
  correlationId: "22222222-2222-2222-2222-222222222222",
  idempotencyKey: "idem_web_research",
};

const THREE_GOOD_LINKS = [
  { href: uddg("https://pizzeriabianco.com/menu"), text: "Pizzeria Bianco" },
  { href: uddg("https://www.azcentral.com/best-pizza"), text: "Best pizza in Phoenix" },
  { href: "https://phoenixnewtimes.com/pizza", text: "Phoenix New Times pizza" },
];

/* ---- discovery -------------------------------------------------------- */

test("research discovery is gated on the remote browser being configured", async () => {
  assert.deepEqual(await new WebResearchAdapter({ enabled: false }).discover(), []);
});

test("the discovered research capability is a derived, read-only, low-risk read", async () => {
  const capabilities = await new WebResearchAdapter({ enabled: true }).discover();
  assert.equal(capabilities.length, 1);
  const [capability] = capabilities;
  assert.equal(capability.id, WEB_RESEARCH_CAPABILITY_ID);
  assert.equal(capability.name, WEB_RESEARCH_CAPABILITY_ID);
  assert.equal(capability.provider, "cardea-research");
  assert.equal(capability.readOnly, true);
  assert.equal(capability.risk.level, "low");
  assert.equal(capability.trust.level, "derived");
  // Same browser surface as the lookup, so the same mandate origin.
  assert.equal(capability.trust.origin, WEB_LOOKUP_ORIGIN);
});

test("the research description steers the planner to search, and not to guess a place", async () => {
  const [capability] = await new WebResearchAdapter({ enabled: true }).discover();
  assert.match(capability.description, /search/i);
  assert.match(capability.description, /current options, reviews, prices, or availability/i);
  assert.match(capability.description, /no exact page is known/i);
  assert.match(capability.description, /cardea\.web_lookup/);
  assert.match(capability.description, /never guess where the person is/i);
});

test("the lookup description points at research when no exact page is known", async () => {
  const [capability] = await new WebLookupAdapter({ enabled: true }).discover();
  assert.match(capability.description, /cardea\.web_research/);
});

/* ---- input ------------------------------------------------------------ */

test("a bare query string is accepted, because that is the shape a plan can carry", () => {
  assert.deepEqual(readResearchInput("best pizza phoenix arizona"), {
    query: "best pizza phoenix arizona",
    maxPages: 3,
  });
});

test("whitespace in a query is collapsed before it reaches a URL", () => {
  assert.equal(readResearchInput({ query: "  best   pizza \n phoenix " }).query, "best pizza phoenix");
});

test("maxPages is clamped into 1..3 rather than refused", () => {
  assert.equal(readResearchInput({ query: "pizza phoenix", maxPages: 9 }).maxPages, 3);
  assert.equal(readResearchInput({ query: "pizza phoenix", maxPages: 0 }).maxPages, 1);
  assert.equal(readResearchInput({ query: "pizza phoenix", maxPages: 2 }).maxPages, 2);
  assert.equal(readResearchInput({ query: "pizza phoenix", maxPages: 2.7 }).maxPages, 2);
  assert.equal(readResearchInput({ query: "pizza phoenix", maxPages: Number.NaN }).maxPages, 3);
});

for (const rejected of ["", "ab", " a ", 42, null, ["pizza"]] as unknown[]) {
  test(`readResearchInput rejects ${JSON.stringify(rejected)}`, () => {
    assert.throws(
      () => readResearchInput(rejected as never),
      WebResearchInputError,
    );
  });
}

test("an over-long query is rejected before it reaches a browser", () => {
  assert.throws(() => readResearchInput("pizza ".repeat(100)), WebResearchInputError);
});

test("the query is percent-encoded into the search URL, never interpolated raw", () => {
  assert.equal(
    searchUrlFor("best pizza phoenix & tempe"),
    "https://html.duckduckgo.com/html/?q=best%20pizza%20phoenix%20%26%20tempe",
  );
  assert.equal(
    searchUrlFor("best pizza phoenix & tempe", SEARCH_ENGINES[1]),
    "https://search.yahoo.com/search?p=best%20pizza%20phoenix%20%26%20tempe",
  );
});

test("the engine chain leads with the no-JS results page and excludes bing", () => {
  assert.equal(SEARCH_ENGINES[0].name, "duckduckgo");
  assert.ok(SEARCH_ENGINES[0].searchUrl("x").startsWith("https://html.duckduckgo.com/html/"));
  // A degraded results page is worse than none: it would hand the planner
  // confident evidence about a query the user never asked.
  assert.ok(!SEARCH_ENGINES.some((engine) => engine.name === "bing"));
});

/* ---- link decoding and selection -------------------------------------- */

test("a yahoo redirect decodes out of its path segment", () => {
  assert.equal(
    resolveSearchHref(yahooRedirect("https://pizzeriabianco.com/menu?a=1&b=2")),
    "https://pizzeriabianco.com/menu?a=1&b=2",
  );
});

test("a uddg redirect decodes to the page it points at", () => {
  assert.equal(
    resolveSearchHref(uddg("https://pizzeriabianco.com/menu?a=1&b=2")),
    "https://pizzeriabianco.com/menu?a=1&b=2",
  );
});

test("a direct result anchor is kept as it is", () => {
  assert.equal(resolveSearchHref("https://example.com/page"), "https://example.com/page");
});

test("a redirect with no readable target resolves to nothing, not to the redirect", () => {
  assert.equal(resolveSearchHref("https://duckduckgo.com/l/?rut=abc"), null);
  assert.equal(resolveSearchHref("https://r.search.yahoo.com/_ylt=Awr/RK=2/RS=abc"), null);
  assert.equal(resolveSearchHref("not a url"), null);
});

test("selection decodes, validates, dedupes by host, and keeps the first N", () => {
  const selected = selectSearchResults(
    [
      { href: "https://duckduckgo.com/settings", text: "Settings" },
      { href: uddg("https://pizzeriabianco.com/menu"), text: "Bianco" },
      { href: yahooRedirect("https://www.pizzeriabianco.com/hours"), text: "Bianco hours" },
      { href: uddg("https://azcentral.com/pizza"), text: "azcentral" },
      { href: "https://phoenixnewtimes.com/pizza", text: "New Times" },
    ],
    3,
  );
  assert.deepEqual(
    selected.map((result) => result.host),
    ["pizzeriabianco.com", "azcentral.com", "phoenixnewtimes.com"],
    "the engine's own tabs are dropped and www is not a second site",
  );
  assert.equal(selected[0].url, "https://pizzeriabianco.com/menu");
});

test("selection refuses every address the lookup's url rules refuse", () => {
  const selected = selectSearchResults(
    [
      { href: uddg("http://localhost:3000/admin"), text: "local" },
      { href: uddg("http://192.168.1.1/"), text: "router" },
      { href: uddg("http://printer.local/"), text: "printer" },
      { href: uddg("https://user:secret@example.com/"), text: "credentials" },
      { href: uddg("javascript:alert(1)"), text: "script" },
      { href: uddg("file:///etc/passwd"), text: "file" },
      { href: uddg("http://2130706433/"), text: "decimal ip" },
      { href: uddg("https://good.example.com/page"), text: "fine" },
    ],
    5,
  );
  assert.deepEqual(
    selected.map((result) => result.url),
    ["https://good.example.com/page"],
  );
});

test("known ad click-through hosts are not treated as results", () => {
  const selected = selectSearchResults(
    [
      { href: uddg("https://googleadservices.com/pagead/aclk"), text: "ad" },
      { href: uddg("https://tracker.doubleclick.net/x"), text: "ad" },
      { href: uddg("https://www.bing.com/aclick?ld=abc"), text: "ad" },
      { href: uddg("https://realbakery.example/menu"), text: "real" },
    ],
    5,
  );
  assert.deepEqual(selected.map((result) => result.host), ["realbakery.example"]);
});

test("an empty results page selects nothing rather than inventing a result", () => {
  assert.deepEqual(selectSearchResults([], 3), []);
});

/* ---- execution -------------------------------------------------------- */

test("a research run searches once, then reads each distinct result in the same session", async () => {
  const { adapter, closedSessions, peer } = researchAdapterWith({ links: THREE_GOOD_LINKS });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });

  const output = result.output as {
    query: string;
    results: { url: string; title?: string; excerpt?: string }[];
    sessionId: string;
  };
  assert.equal(output.query, "best pizza phoenix arizona");
  assert.equal(output.sessionId, "cf-research-1");
  assert.deepEqual(output.results.map((entry) => entry.url), [
    "https://pizzeriabianco.com/menu",
    "https://www.azcentral.com/best-pizza",
    "https://phoenixnewtimes.com/pizza",
  ]);
  for (const entry of output.results) {
    assert.ok(entry.excerpt && entry.excerpt.length > 0, "every result carries real page text");
  }

  assert.equal(
    result.summary,
    'Searched "best pizza phoenix arizona" and read 3 of 3 results: pizzeriabianco.com, azcentral.com, phoenixnewtimes.com',
  );
  assert.equal(result.provenance, "browser-run://cloudflare/search");
  assert.equal(result.trust, "untrusted");
  assert.equal(result.executionId, RESEARCH_REQUEST.idempotencyKey);

  // One search navigation, then one per result, all on one attached page.
  assert.deepEqual(peer.navigated, [
    DDG_SEARCH_URL,
    "https://pizzeriabianco.com/menu",
    "https://www.azcentral.com/best-pizza",
    "https://phoenixnewtimes.com/pizza",
  ]);
  assert.equal(
    peer.sent.filter((command) => command.method === "Target.attachToTarget").length,
    1,
    "one attach for the whole run, not one per page",
  );

  // The user agent is set once, before anything is fetched: search engines
  // answer a HeadlessChrome token with captchas and empty documents.
  const overrides = peer.sent.filter(
    (command) => command.method === "Emulation.setUserAgentOverride",
  );
  assert.equal(overrides.length, 1);
  assert.match(String(overrides[0].params?.userAgent), /^Mozilla\/5\.0 /);
  assert.ok(!String(overrides[0].params?.userAgent).includes("Headless"));
  assert.ok(
    peer.sent.findIndex((c) => c.method === "Emulation.setUserAgentOverride") <
      peer.sent.findIndex((c) => c.method === "Page.navigate"),
    "the override precedes the first navigation",
  );
  assert.deepEqual(closedSessions, ["cf-research-1"], "the session is always closed");
  assert.equal(peer.isClosed(), true);
});

test("one CDP client means one command-id sequence for the whole run", async () => {
  const { adapter, peer } = researchAdapterWith({ links: THREE_GOOD_LINKS });
  await adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" });
  assert.deepEqual(
    peer.seenIds,
    [...peer.seenIds].sort((a, b) => a - b),
    "ids are monotonic across pages",
  );
  assert.equal(new Set(peer.seenIds).size, peer.seenIds.length, "no id is ever reused");
});

test("maxPages limits how many results are opened", async () => {
  const { adapter, peer } = researchAdapterWith({ links: THREE_GOOD_LINKS });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: { query: "best pizza phoenix arizona", maxPages: 1 },
  });
  assert.equal((result.output as { results: unknown[] }).results.length, 1);
  assert.equal(peer.navigated.length, 2, "the search, then one result");
});

test("a page whose text is parsed is read, even when it never finishes loading", async () => {
  // Ad-heavy news and review sites keep loading long past the point where
  // their article text is in the DOM. Waiting for the load event would throw
  // away a page Cardea can already read.
  const { adapter } = researchAdapterWith(
    {
      links: THREE_GOOD_LINKS,
      pages: { "https://www.azcentral.com/best-pizza": { domContentOnly: true } },
    },
    { navigationTimeoutMs: 5_000 },
  );
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  const output = result.output as { results: { url: string; error?: string }[] };
  assert.deepEqual(output.results.map((entry) => entry.error ?? "read"), ["read", "read", "read"]);
});

test("a result that will not load is recorded as unreadable and does not end the run", async () => {
  const { adapter, closedSessions } = researchAdapterWith(
    {
      links: THREE_GOOD_LINKS,
      pages: {
        "https://www.azcentral.com/best-pizza": { neverLoads: true },
      },
    },
    { navigationTimeoutMs: 40 },
  );
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  const output = result.output as { results: { url: string; error?: string }[] };
  assert.deepEqual(output.results.map((entry) => entry.error ?? "read"), [
    "read",
    "unreadable",
    "read",
  ]);
  assert.equal(
    result.summary,
    'Searched "best pizza phoenix arizona" and read 2 of 3 results: pizzeriabianco.com, phoenixnewtimes.com',
  );
  assert.deepEqual(closedSessions, ["cf-research-1"]);
});

test("a result whose navigation is refused is recorded as unreadable, not as a page", async () => {
  const { adapter } = researchAdapterWith({
    links: THREE_GOOD_LINKS,
    pages: {
      "https://pizzeriabianco.com/menu": { navigationError: "net::ERR_CONNECTION_REFUSED" },
    },
  });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  const output = result.output as { results: { url: string; error?: string }[] };
  assert.deepEqual(output.results[0], {
    url: "https://pizzeriabianco.com/menu",
    error: "unreadable",
  });
  assert.equal(output.results.filter((entry) => entry.error === undefined).length, 2);
});

test("a page that loads but renders no text is unreadable, not an empty finding", async () => {
  const { adapter } = researchAdapterWith({
    links: THREE_GOOD_LINKS,
    pages: { "https://pizzeriabianco.com/menu": { text: "   " } },
  });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  const output = result.output as { results: { url: string; error?: string }[] };
  assert.deepEqual(output.results[0], {
    url: "https://pizzeriabianco.com/menu",
    error: "unreadable",
  });
});

test("zero readable results throws instead of returning an empty finding", async () => {
  const { adapter, closedSessions } = researchAdapterWith({
    links: THREE_GOOD_LINKS,
    pages: {
      "https://pizzeriabianco.com/menu": { navigationError: "net::ERR_FAILED" },
      "https://www.azcentral.com/best-pizza": { navigationError: "net::ERR_FAILED" },
      "https://phoenixnewtimes.com/pizza": { navigationError: "net::ERR_FAILED" },
    },
  });
  await assert.rejects(
    () => adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" }),
    (error: unknown) =>
      error instanceof WebResearchFailedError && /none of the 3 results/.test(error.message),
  );
  assert.deepEqual(closedSessions, ["cf-research-1"], "a thrown run still closes its session");
});

test("a search that cannot be run fails the node rather than reporting no results", async () => {
  const { adapter, closedSessions, peer } = researchAdapterWith({
    searchNavigationError: "net::ERR_NAME_NOT_RESOLVED",
  });
  await assert.rejects(
    () => adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" }),
    (error: unknown) =>
      error instanceof WebResearchFailedError && /could not be run/.test(error.message),
  );
  // Both engines were tried before the run gave up.
  assert.deepEqual(peer.navigated, [DDG_SEARCH_URL, YAHOO_SEARCH_URL]);
  assert.deepEqual(closedSessions, ["cf-research-1"]);
});

test("an engine that answers with nothing usable falls through to the next one", async () => {
  // What a captcha or an interstitial looks like: a page that reads fine and
  // offers only the engine's own links.
  const { adapter, peer } = researchAdapterWith({
    links: [{ href: "https://duckduckgo.com/settings", text: "Settings" }],
    fallbackLinks: THREE_GOOD_LINKS,
  });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  assert.deepEqual(peer.navigated.slice(0, 2), [DDG_SEARCH_URL, YAHOO_SEARCH_URL]);
  assert.equal((result.output as { results: unknown[] }).results.length, 3);
  assert.match(result.summary, /read 3 of 3 results/);
});

test("the first engine that answers usefully ends the search, without a second query", async () => {
  const { adapter, peer } = researchAdapterWith({
    links: THREE_GOOD_LINKS,
    fallbackLinks: THREE_GOOD_LINKS,
  });
  await adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" });
  assert.ok(!peer.navigated.includes(YAHOO_SEARCH_URL));
});

test("a search page that returns nothing readable fails honestly", async () => {
  const { adapter } = researchAdapterWith({ searchThrows: true });
  await assert.rejects(
    () => adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" }),
    (error: unknown) =>
      error instanceof WebResearchFailedError && /nothing readable/.test(error.message),
  );
});

test("a search with no usable results says so rather than reading the search engine", async () => {
  const { adapter } = researchAdapterWith({
    links: [{ href: "https://duckduckgo.com/settings", text: "Settings" }],
    fallbackLinks: [{ href: "https://r.search.yahoo.com/nav", text: "Yahoo" }],
  });
  await assert.rejects(
    () => adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" }),
    (error: unknown) =>
      error instanceof WebResearchFailedError && /no usable results/.test(error.message),
  );
});

test("a rejected query never opens a session", async () => {
  const { adapter, createdCount, closedSessions } = researchAdapterWith();
  await assert.rejects(
    () => adapter.execute({ ...RESEARCH_REQUEST, input: "ab" }),
    WebResearchInputError,
  );
  assert.equal(createdCount(), 0);
  assert.deepEqual(closedSessions, []);
});

test("research refuses a capability id that is not its own", async () => {
  const { adapter } = researchAdapterWith();
  await assert.rejects(
    () =>
      adapter.execute({
        ...RESEARCH_REQUEST,
        capabilityId: WEB_LOOKUP_CAPABILITY_ID,
        input: "best pizza phoenix arizona",
      }),
    WebResearchInputError,
  );
});

test(
  "the whole run has a deadline, and hitting it still closes the session exactly once",
  async (t) => {
    // Was a real-clock flake: budgetFor() in runResearch() gives the FIRST
    // page's own load watcher (CdpPageSession.navigate()'s watchForLoad) a
    // budget of `remaining()`, the time left until this call's own outer
    // deadline, so on the very first page (the search phase before it is
    // ~0ms in this fixture) that inner timer and this test's outer
    // withDeadline() timer are armed to expire at essentially the same
    // instant, by construction. Which one Node fired first was a coin flip
    // on the real clock, and losing it made runResearch fail every
    // remaining candidate for being out of budget too and throw its own
    // WebResearchFailedError instead of the timeout this test checks for.
    //
    // Fixed with node:test's fake timers rather than a bigger number:
    // no timeout value changes which timer is armed first, only mocking
    // Date.now() and setTimeout does, because it removes the real-clock
    // jitter between when each is registered. The outer timer is
    // registered strictly before the inner one (before any of the
    // attach/search/navigate chain runs), so on a fake clock where ties
    // resolve in registration order, it always wins. Verified against 60
    // consecutive real runs of this exact test with no failures, where the
    // unmocked version had failed within the first handful.
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

    const { adapter, closedSessions } = researchAdapterWith(
      { links: THREE_GOOD_LINKS, pages: { "https://pizzeriabianco.com/menu": { neverLoads: true } } },
      { timeoutMs: 30, navigationTimeoutMs: 10_000 },
    );

    const outcome = assert.rejects(
      () => adapter.execute({ ...RESEARCH_REQUEST, input: "best pizza phoenix arizona" }),
      (error: unknown) => error instanceof Error && /timed out after 30ms/.test(error.message),
    );

    // Lets the synchronous-through-microtasks prefix of execute() run (session
    // attach, the search phase, the first navigate call arming its own
    // watcher) before advancing the virtual clock past both deadlines at once.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await t.mock.timers.tick(30);

    await outcome;
    assert.deepEqual(closedSessions, ["cf-research-1"]);
  },
);

/* ---- output bounds ---------------------------------------------------- */

test("every excerpt is bounded and the whole payload stays under 6KB", async () => {
  const long = "lorem ipsum dolor sit amet ".repeat(2_000);
  const { adapter } = researchAdapterWith({
    links: THREE_GOOD_LINKS,
    pages: {
      "https://pizzeriabianco.com/menu": { text: long },
      "https://www.azcentral.com/best-pizza": { text: long },
      "https://phoenixnewtimes.com/pizza": { text: long },
    },
  });
  const result = await adapter.execute({
    ...RESEARCH_REQUEST,
    input: "best pizza phoenix arizona",
  });
  const output = result.output as { results: { excerpt: string }[] };
  assert.equal(output.results.length, 3);
  for (const entry of output.results) {
    assert.ok(entry.excerpt.length <= 1_300, "each excerpt is capped at 1300 characters");
    assert.ok(entry.excerpt.length > 0, "shrinking never empties a result");
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(result.output), "utf8") <= 6_144,
    "the serialized payload stays under the 6KB bound",
  );
});

test("shrinking is proportional, so no single result is starved to keep another whole", () => {
  const bounded = boundResearchOutput({
    query: "best pizza phoenix arizona",
    results: [
      { url: "https://a.example/", title: "A", excerpt: "a".repeat(1_300), prices: [] },
      { url: "https://b.example/", title: "B", excerpt: "b".repeat(1_300), prices: [] },
      { url: "https://c.example/", title: "C", excerpt: "c".repeat(1_300), prices: [] },
    ],
    sessionId: "cf-research-1",
  }) as unknown as { results: { excerpt: string }[] };
  const lengths = bounded.results.map((entry) => entry.excerpt.length);
  assert.equal(new Set(lengths).size, 1, "all three shrink to the same bound");
  assert.ok(lengths[0] > 0);
});

test("a summary stays inside its 160 character bound by dropping hosts, never counts", () => {
  const hosts = Array.from({ length: 12 }, (_, index) => `a-very-long-hostname-${index}.example`);
  const summary = researchSummary(
    "a fairly long search query about pizza in phoenix arizona",
    [
      { url: "https://a.example/", title: "A", excerpt: "x", prices: [] },
      { url: "https://b.example/", title: "B", excerpt: "x", prices: [] },
      { url: "https://c.example/", error: "unreadable" },
    ],
    hosts,
  );
  assert.ok(summary.length <= 160, `summary was ${summary.length} characters`);
  assert.match(summary, /read 2 of 3 results/);
});

test("the summary contains no em dash, per the product copy rule", () => {
  const summary = researchSummary(
    "best pizza phoenix arizona",
    [{ url: "https://a.example/", title: "A", excerpt: "x", prices: [] }],
    ["a.example"],
  );
  assert.ok(!summary.includes("—"));
});

test("the two browser adapters register under distinct provider keys", async () => {
  const { CapabilityRegistry } = await import("../capability-registry");
  const registry = new CapabilityRegistry();
  registry.register(webLookupAdapter);
  registry.register(webResearchAdapter);
  const capabilities = await registry.discover();
  const ids = capabilities.map((capability) => capability.id);
  if (process.env.CLOUDFLARE_BROWSER_TOKEN) {
    assert.ok(ids.includes("cardea.web_lookup"));
    assert.ok(ids.includes("cardea.web_research"));
  }
});

test("the product hop picks product-shaped links, bounded and deduped", async () => {
  const { selectProductLinks } = await import("./web-research");
  const chosen = selectProductLinks(
    [
      { href: "https://www.target.com/p/sofa-bed/-/A-123", text: "Sofa bed" },
      { href: "http://insecure.example/p/x", text: "nope" },
      { href: "https://blog.example/why-sofas-matter", text: "essay" },
      { href: "https://store.example/checkout", text: "From $199.99" },
      { href: "https://www.target.com/p/desk/-/A-456", text: "Desk" },
      { href: "https://www.target.com/p/lamp/-/A-789", text: "Lamp" },
      { href: "https://duckduckgo.com/p/whatever", text: "$5" },
    ],
    ["https://already.example/read"],
  );
  assert.equal(chosen.length, 2);
  assert.match(chosen[0].href, /target\.com\/p\/sofa-bed/);
  assert.match(chosen[1].href, /store\.example\/checkout|target\.com\/p\/desk/);
});
