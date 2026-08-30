// Note: no `import "server-only"` here — see harness/planner.ts for why (the
// package is not an installed dependency and plain `node --test` cannot
// resolve it). The two modules that do touch a socket and a credential
// (`lib/browser-run/cloudflare` and `lib/browser-run/cdp-socket`) are both
// `server-only` and are reached only through the lazy import at the bottom of
// this file, so a test that injects its own transport never loads them.
//
// Relative (not `@/...`-aliased) *value* imports for the same reason as
// execute-node.ts: the alias is a compile-time aid only and is not rewritten
// in the emitted CommonJS that `pnpm test:harness` runs.
import type { JsonValue } from "@/core/contracts/types";
import {
  MAX_PAGE_EXCERPT_CHARS,
  MAX_SEARCH_LINK_TEXT_CHARS,
  MAX_TARGET_URL_LENGTH,
  type CdpCommand,
  type CdpTransport,
  type PageRead,
  type SearchAnchor,
  attachToTargetCommand,
  createCdpEncoder,
  decodeCdpMessage,
  encodeCdpCommand,
  evaluateCommand,
  navigateCommand,
  pageEnableCommand,
  PAGE_READ_EXPRESSION,
  readPageEvaluation,
  readSearchLinksEvaluation,
  runtimeEnableCommand,
  SEARCH_RESULT_LINKS_EXPRESSION,
  userAgentOverrideCommand,
  validateTargetUrl,
} from "../../core/browser-run/protocol";
import {
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_LOOKUP_ORIGIN,
  WEB_RESEARCH_CAPABILITY_ID,
} from "../../core/contracts/safe-capabilities";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";

export { WEB_LOOKUP_CAPABILITY_ID, WEB_LOOKUP_ORIGIN, WEB_RESEARCH_CAPABILITY_ID };

/**
 * `cardea.web_lookup`: open ONE public webpage in Cardea's remote Cloudflare
 * Browser Run session, read it, close the session, and return what was there.
 *
 * This is the only capability in the harness that touches the live web. It is
 * deliberately the smallest honest version of that: one navigation, one read,
 * no clicking, no typing, no form submission, no login, no second page. Every
 * value it returns is something the page actually said.
 *
 * Trust design, mirroring the internal fixture: the capability *descriptor* is
 * "derived", because the navigate-and-read function is Cardea's own and the
 * policy engine's untrusted-capability rule must not gate it into an approval
 * on every read. The *evidence it returns* is "untrusted", because it is text
 * from a page nobody vetted and must never be treated as a verified fact or
 * read as an instruction.
 *
 * The session is closed before this returns. `sessionId` still travels in the
 * output so a later pass can attach a live view to a lookup while it runs; it
 * is an identifier, not a claim that anything is still open.
 */

/** Hard cap on the whole read, navigation included. */
export const WEB_LOOKUP_TIMEOUT_MS = 15_000;

/** Hard cap on the serialized output, well under the harness's 8KB event bound. */
const MAX_OUTPUT_BYTES = 6_144;

/** Invalid input: a bad URL is the caller's mistake, not a provider failure. */
export class WebLookupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebLookupInputError";
  }
}

/** The read did not complete: timeout, navigation error, or an unreadable page. */
export class WebLookupFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebLookupFailedError";
  }
}

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Host suffixes that never name a public site. `.local` and `.localhost` are
 * link-local/loopback by definition; `.internal` and `.home.arpa` are the
 * reserved private-network names.
 */
const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

/**
 * The URL rule, stated once: a bounded, credential-free http(s) URL whose host
 * is a public dotted name.
 *
 * The dot requirement is doing most of the work. It rejects `localhost` and
 * every single-label intranet name outright, and it rejects the decimal and
 * hex forms of an IPv4 literal (`http://2130706433/`) because those have no
 * dot either. IP literals that DO have dots, and bracketed IPv6 literals, are
 * refused wholesale rather than range-checked: Cardea has no reason to browse
 * a bare address, and "no IP literals" is a rule that cannot be defeated by an
 * encoding trick the way a private-range check can.
 *
 * This is not a substitute for network egress control, and it is not claimed
 * to be one. It is the honest, checkable bound on what a model-produced URL
 * may ask a real browser to open.
 */
export function validateLookupUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new WebLookupInputError("web lookup needs a url string");
  }
  if (raw.length > MAX_TARGET_URL_LENGTH) {
    throw new WebLookupInputError(
      `web lookup url exceeds ${MAX_TARGET_URL_LENGTH} characters`,
    );
  }
  const url = validateTargetUrl(raw);
  if (!url) {
    throw new WebLookupInputError("web lookup url must be a bounded http or https URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebLookupInputError("web lookup url must not carry credentials");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    throw new WebLookupInputError("web lookup url must name a host, not an IP literal");
  }
  if (IPV4_LITERAL.test(host)) {
    throw new WebLookupInputError("web lookup url must name a host, not an IP literal");
  }
  if (!host.includes(".")) {
    throw new WebLookupInputError("web lookup url must name a public host with a dot");
  }
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new WebLookupInputError("web lookup url must name a public host");
  }
  return url;
}

/** Reads `{ url }` out of the capability input, in either shape the plan can carry. */
export function readLookupInput(input: JsonValue): { url: URL; objective?: string } {
  // The planner's structured output can only carry flat primitives per
  // capability (see the schema note in planner.ts), so a bare URL string is
  // the shape a real plan produces. The object form is accepted too, for a
  // caller that can express one.
  if (typeof input === "string") return { url: validateLookupUrl(input) };
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new WebLookupInputError("web lookup needs a url");
  }
  const record = input as Record<string, JsonValue>;
  const url = validateLookupUrl(record.url);
  const objective = typeof record.objective === "string" ? record.objective.slice(0, 400) : undefined;
  return objective === undefined ? { url } : { url, objective };
}

type WebLookupSession = { sessionId: string; webSocketDebuggerUrl: string };

export type WebLookupDeps = {
  createSession: () => Promise<WebLookupSession>;
  connect: (session: WebLookupSession) => Promise<CdpTransport>;
  /** Never throws: a close that fails is a leak Cloudflare's keep_alive reaps. */
  closeSession: (sessionId: string) => Promise<void>;
};

/**
 * One CDP conversation over one already-connected transport.
 *
 * There is exactly one of these per node run, and it is the only CDP client in
 * the harness that reads pages. That matters for more than tidiness: a CDP
 * connection carries a single command-id sequence, so two independent drivers
 * sharing one socket would mint colliding ids and start matching each other's
 * replies. One session owns one encoder, one message dispatcher, and one
 * attached page, and the page survives across navigations, which is what lets
 * a search and the results it points at be read without opening a second
 * remote browser.
 *
 * Failure model. A transport error or close is *fatal*: every in-flight
 * command rejects and every later one rejects immediately, because the socket
 * is gone and nothing more can be read over it. A refused command or a page
 * that will not load is *local*: it rejects the one operation that asked for
 * it and leaves the session usable, which is what makes tolerating a single
 * unreadable result possible without abandoning the ones after it.
 */
/**
 * How long after `DOMContentLoaded` a page is given to fill itself in before
 * it is read. Small on purpose: the text a read is after is already in the
 * parsed document, and this is a courtesy to scripts, not a wait for them.
 */
export const DOM_CONTENT_GRACE_MS = 2_500;

/** One in-flight wait for a page to become readable. */
type LoadWatcher = { settle: (error: Error | null) => void; domContent: () => void };

export class CdpPageSession {
  private readonly encoder = createCdpEncoder();
  private readonly pending = new Map<
    number,
    { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private readonly loadWaiters = new Set<LoadWatcher>();
  private fatal: Error | null = null;
  private targetSessionId: string | null = null;

  constructor(private readonly transport: CdpTransport) {
    transport.onError((error) => this.die(new WebLookupFailedError(error.message)));
    transport.onClose(() => {
      this.die(new WebLookupFailedError("the remote browser closed before the page was read"));
    });
    transport.onMessage((raw) => this.receive(raw));
  }

  /**
   * Opens a page target and enables the two domains a read needs. Safe to call
   * more than once; only the first call talks to the browser.
   */
  async attach(): Promise<void> {
    if (this.targetSessionId !== null) return;

    const targets = await this.call(this.encoder.command("Target.getTargets"));
    const infos = Array.isArray(targets.targetInfos) ? targets.targetInfos : [];
    const page = infos.find((info): info is { targetId: string; type: string } => {
      if (typeof info !== "object" || info === null) return false;
      const record = info as Record<string, unknown>;
      return record.type === "page" && typeof record.targetId === "string";
    });

    let targetId = page?.targetId;
    if (targetId === undefined) {
      const created = await this.call(
        this.encoder.command("Target.createTarget", { url: "about:blank" }),
      );
      if (typeof created.targetId !== "string") {
        throw new WebLookupFailedError("the remote browser had no page to open");
      }
      targetId = created.targetId;
    }

    const attached = await this.call(attachToTargetCommand(this.encoder, targetId));
    if (typeof attached.sessionId !== "string") {
      throw new WebLookupFailedError("could not attach to a page in the remote browser");
    }
    this.targetSessionId = attached.sessionId;
    await this.call(pageEnableCommand(this.encoder, this.targetSessionId));
    await this.call(runtimeEnableCommand(this.encoder, this.targetSessionId));
  }

  /**
   * Navigates the attached page and waits for its load event.
   *
   * The two things that can go wrong here settle on different clocks, and
   * both are observed from the moment they exist. Chrome answers
   * `Page.navigate` only once the navigation has committed, so on a host that
   * hangs on connect the load deadline can expire while that reply is still
   * outstanding. Leaving either outcome unobserved until the other arrives
   * would surface as an unhandled rejection and take the whole process down
   * instead of failing one page.
   *
   * So neither branch below is allowed to reject: each resolves to an `Error`
   * or to null, and the race decides. A refused navigation is known at once; a
   * successful one is only known when the page loads, so that branch defers to
   * the load watcher rather than resolving early.
   */
  async navigate(url: string, loadTimeoutMs: number): Promise<void> {
    const sessionId = this.requireAttached();
    // Armed before the command is sent, so a load event arriving on the heels
    // of the navigate reply cannot be missed.
    const load = this.watchForLoad(loadTimeoutMs);
    const loaded = load.settled.then(
      () => null,
      (error: Error) => error,
    );
    const navigated = this.call(navigateCommand(this.encoder, sessionId, url)).then(
      (result) => {
        const errorText = result.errorText;
        return typeof errorText === "string" && errorText.length > 0
          ? new WebLookupFailedError(`navigation failed: ${errorText}`)
          : null;
      },
      (error: Error) => error,
    );

    const outcome = await Promise.race([loaded, navigated.then((error) => error ?? loaded)]);
    load.cancel();
    if (outcome) throw outcome;
  }

  /**
   * Presents this browser as a current desktop Chrome for the rest of the
   * session. Applied before the first navigation, because the header is read
   * on the request, not on the page.
   */
  async presentAsDesktopBrowser(): Promise<void> {
    await this.call(userAgentOverrideCommand(this.encoder, this.requireAttached()));
  }

  /** Evaluates one expression in the attached page and returns the raw reply. */
  evaluate(expression: string): Promise<Record<string, unknown>> {
    return this.call(evaluateCommand(this.encoder, this.requireAttached(), expression));
  }

  /** Navigates and reads the page's title, final URL, and visible text. */
  async readPage(url: string, loadTimeoutMs: number): Promise<PageRead> {
    await this.navigate(url, loadTimeoutMs);
    const read = readPageEvaluation(await this.evaluate(PAGE_READ_EXPRESSION));
    if (!read) throw new WebLookupFailedError("the page returned no readable text");
    return read;
  }

  private requireAttached(): string {
    if (this.targetSessionId === null) {
      throw new WebLookupFailedError("the remote browser has no attached page");
    }
    return this.targetSessionId;
  }

  private call(command: CdpCommand): Promise<Record<string, unknown>> {
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(command.id, { resolve, reject });
      try {
        this.transport.send(encodeCdpCommand(command));
      } catch {
        this.pending.delete(command.id);
        reject(new WebLookupFailedError("the remote browser connection dropped mid-read"));
      }
    });
  }

  /**
   * A one-shot wait for the page to become readable.
   *
   * "Readable" is deliberately not "fully loaded". `Page.loadEventFired` waits
   * on every image, font, ad, and tracker a page pulls in, and on real news and
   * review sites that routinely runs past any sane per-page budget, which meant
   * pages whose text had been sitting in the DOM for seconds were being
   * recorded as unreadable. So `Page.domContentEventFired` starts a short grace
   * instead: the document is parsed, its text is there, and scripts get a
   * moment to fill anything in. Whichever comes first wins, and the hard
   * deadline still bounds the whole wait.
   *
   * `cancel` resolves rather than rejects, so a caller that abandons the wait
   * (because the navigation itself failed) never leaves an unobserved rejection
   * behind.
   */
  private watchForLoad(timeoutMs: number): { settled: Promise<void>; cancel: () => void } {
    let cancel = () => {};
    const settled = new Promise<void>((resolve, reject) => {
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (error: Error | null) => {
        clearTimeout(hardTimer);
        if (graceTimer) clearTimeout(graceTimer);
        this.loadWaiters.delete(watcher);
        if (error) reject(error);
        else resolve();
      };
      const watcher: LoadWatcher = {
        settle: finish,
        domContent: () => {
          if (graceTimer) return;
          graceTimer = setTimeout(() => finish(null), Math.min(DOM_CONTENT_GRACE_MS, timeoutMs));
        },
      };
      const hardTimer = setTimeout(
        () => finish(new WebLookupFailedError(`the page did not load within ${timeoutMs}ms`)),
        timeoutMs,
      );
      cancel = () => finish(null);
      if (this.fatal) {
        finish(this.fatal);
        return;
      }
      this.loadWaiters.add(watcher);
    });
    return { settled, cancel };
  }

  private receive(raw: string) {
    const message = decodeCdpMessage(raw);
    if (!message) return;

    if (message.kind === "result") {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      entry?.resolve(message.result);
      return;
    }
    if (message.kind === "error") {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      // A refused command fails only the operation that issued it. An error
      // for an id nobody is waiting on is dropped rather than escalated: it
      // cannot be attributed to a caller, and guessing would take down reads
      // that are still perfectly able to finish.
      entry?.reject(
        new WebLookupFailedError(`the remote browser refused a command: ${message.message}`),
      );
      return;
    }
    if (message.method === "Page.loadEventFired") {
      for (const waiter of [...this.loadWaiters]) waiter.settle(null);
      return;
    }
    if (message.method === "Page.domContentEventFired") {
      for (const waiter of [...this.loadWaiters]) waiter.domContent();
    }
  }

  private die(error: Error) {
    if (this.fatal) return;
    this.fatal = error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) entry.reject(error);
    for (const waiter of [...this.loadWaiters]) waiter.settle(error);
  }
}

/**
 * Rejects with `message` once `timeoutMs` elapses, whatever the wrapped work
 * is still doing. The wrapped promise is not cancellable (CDP has no such
 * notion), so its eventual outcome is deliberately observed and dropped: the
 * transport is closed by the caller's `finally` either way, and an abandoned
 * rejection must never surface as an unhandled one.
 */
function withDeadline<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebLookupFailedError(message)), timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    work.catch(() => {});
  });
}

/**
 * Drives one page read over an already-connected CDP transport.
 *
 * Target.getTargets -> attach (flat) -> Page.enable -> Runtime.enable ->
 * Page.navigate -> Page.loadEventFired -> Runtime.evaluate.
 *
 * The single deadline covers the whole sequence, so a page that connects and
 * then never loads fails the same way as one that never connects.
 */
export function readPageOverCdp(
  transport: CdpTransport,
  targetUrl: string,
  timeoutMs: number = WEB_LOOKUP_TIMEOUT_MS,
): Promise<PageRead> {
  const session = new CdpPageSession(transport);
  const work = (async () => {
    await session.attach();
    return session.readPage(targetUrl, timeoutMs);
  })();
  return withDeadline(work, timeoutMs, `web lookup timed out after ${timeoutMs}ms`);
}

const LOOKUP_DESCRIPTION = [
  "Opens one public webpage in Cardea's remote browser and reads it.",
  "Input: the full URL to open, as a string (or { url }).",
  "Use it to look at real listings, prices, schedules, timetables, documentation, and articles instead of recalling them.",
  "Give one specific full URL, prefer well-known public sites, and never a page that requires a login, a cookie banner dismissal, or a form submission.",
  "It returns the page title and a bounded excerpt of the page's visible text. It cannot click, type, submit, or follow a second page.",
  "Use this only when the user or an earlier brief names an exact page. When no exact page is known, use cardea.web_research instead, which searches first.",
].join(" ");

export class WebLookupAdapter implements CapabilityAdapter {
  readonly provider = "cardea";

  constructor(
    private readonly options: {
      enabled?: boolean;
      deps?: WebLookupDeps;
      /** Test seam only. Production always uses `WEB_LOOKUP_TIMEOUT_MS`. */
      timeoutMs?: number;
    } = {},
  ) {}

  /**
   * Advertised only when the remote browser is actually configured. There is
   * no honest degraded form of this capability: a planner told it can browse
   * would build a plan around evidence Cardea cannot go and get. Mirrors the
   * way ComposioCapabilityAdapter gates its catalogue on COMPOSIO_API_KEY.
   */
  private isEnabled(): boolean {
    if (this.options.enabled !== undefined) return this.options.enabled;
    if (this.options.deps) return true;
    return Boolean(
      process.env.CLOUDFLARE_BROWSER_TOKEN?.trim() && process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    );
  }

  async discover(): Promise<NormalizedCapability[]> {
    if (!this.isEnabled()) return [];
    return [
      {
        id: WEB_LOOKUP_CAPABILITY_ID,
        provider: this.provider,
        name: WEB_LOOKUP_CAPABILITY_ID,
        description: LOOKUP_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", maxLength: MAX_TARGET_URL_LENGTH },
            objective: { type: "string", maxLength: 400 },
          },
          required: ["url"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            finalUrl: { type: "string" },
            title: { type: "string" },
            excerpt: { type: "string" },
            sessionId: { type: "string" },
          },
        },
        risk: { level: "low", categories: ["read"] },
        trust: { level: "derived", origin: WEB_LOOKUP_ORIGIN, provenance: "cardea:web_lookup" },
        readOnly: true,
      },
    ];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    if (request.capabilityId !== WEB_LOOKUP_CAPABILITY_ID) {
      throw new WebLookupInputError(`web lookup adapter cannot execute ${request.capabilityId}`);
    }
    const { url } = readLookupInput(request.input);
    const deps = this.options.deps ?? (await loadLiveDeps());

    const session = await deps.createSession();
    let transport: CdpTransport | null = null;
    try {
      transport = await deps.connect(session);
      const read = await readPageOverCdp(
        transport,
        url.href,
        this.options.timeoutMs ?? WEB_LOOKUP_TIMEOUT_MS,
      );
      const host = hostOf(read.finalUrl) ?? url.host;
      const title = read.title.length > 0 ? read.title : host;
      const output = boundOutput({
        url: url.href,
        finalUrl: read.finalUrl,
        title,
        excerpt: read.excerpt,
        prices: read.prices,
        ratings: read.ratings,
        sessionId: session.sessionId,
      });
      return {
        executionId: request.idempotencyKey,
        output,
        summary: `Read "${title}" at ${host}`,
        provenance: `browser-run://cloudflare/${host}`,
        // The descriptor is derived; the page text is not. Anything read off
        // a page Cardea does not own is untrusted evidence, full stop.
        trust: "untrusted",
      };
    } finally {
      transport?.close();
      // The session is closed on every path, including a thrown timeout. A
      // failed close is Cloudflare's keep_alive to reap and must never mask
      // the error that is on its way out.
      await deps.closeSession(session.sessionId);
    }
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

/**
 * Keeps the serialized payload under `MAX_OUTPUT_BYTES` by shortening the one
 * field that can be long. The bound is re-applied to bytes, not characters,
 * because a page of multi-byte text is several times its own length on the
 * wire.
 */
function boundOutput(payload: {
  url: string;
  finalUrl: string;
  title: string;
  excerpt: string;
  prices: string[];
  ratings: string[];
  sessionId: string;
}): JsonValue {
  let excerpt = payload.excerpt.slice(0, MAX_PAGE_EXCERPT_CHARS);
  let candidate = { ...payload, excerpt };
  while (
    excerpt.length > 0 &&
    Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_OUTPUT_BYTES
  ) {
    excerpt = excerpt.slice(0, Math.floor(excerpt.length * 0.8));
    candidate = { ...payload, excerpt };
  }
  return candidate as unknown as JsonValue;
}

/**
 * Cloudflare admits three concurrent browsers on this plan: one is the
 * board's shared tile browser, which leaves two for research, while missions
 * run up to five nodes at once. A refusal at the cap is therefore an expected
 * collision with a sibling branch, not a failure, and it resolves itself the
 * moment that sibling finishes and releases its browser. So wait briefly and
 * try again, a bounded number of times, before letting the refusal surface.
 */
export const SESSION_CREATE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

export async function createSessionWithRetry(
  create: () => Promise<WebLookupSession>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<WebLookupSession> {
  for (const delayMs of SESSION_CREATE_RETRY_DELAYS_MS) {
    try {
      return await create();
    } catch (error) {
      if (!isRetryableSessionRefusal(error)) throw error;
      await sleep(delayMs);
    }
  }
  return create();
}

/**
 * Only provider-side refusals earn a retry: 429 is the concurrency cap, 5xx
 * is a transient provider fault. A 4xx like a bad credential would refuse
 * identically forever, so it surfaces immediately.
 */
function isRetryableSessionRefusal(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "BrowserRunApiError") return false;
  const status = (error as { status?: unknown }).status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * The live wiring, loaded only when no deps were injected. Both modules below
 * are `server-only` and reach a real credential and a real socket, which is
 * exactly why this import is lazy: importing them at module scope would make
 * this file unloadable in a plain `node --test` process.
 */
async function loadLiveDeps(): Promise<WebLookupDeps> {
  const cloudflare = await import("../../lib/browser-run/cloudflare");
  const socket = await import("../../lib/browser-run/cdp-socket");
  return {
    createSession: () => createSessionWithRetry(() => cloudflare.createSession()),
    connect: (session) => socket.connectCdpTransport(session.webSocketDebuggerUrl),
    closeSession: async (sessionId) => {
      await cloudflare.closeSession(sessionId);
    },
  };
}

export const webLookupAdapter = new WebLookupAdapter();

/* ======================================================================== *
 * cardea.web_research: search, select, read
 * ======================================================================== */

/**
 * `cardea.web_research`: run one search in Cardea's remote browser, pick a few
 * distinct sites off the results, and read each of them, all in one session.
 *
 * This is the capability that lets a mission *discover* something. The lookup
 * can only open a page the planner already knew the address of, which means
 * Cardea could confirm a fact but never go and find current options, prices,
 * reviews, or availability that nobody had named yet.
 *
 * It is still the same small, honest surface as the lookup. It navigates and
 * reads. It never types into a page, clicks a control, submits a form, logs
 * in, or dismisses a banner. The query travels in the URL of DuckDuckGo's
 * server-rendered no-JS results page, so the search itself is a navigation.
 *
 * Every result URL is decoded out of DuckDuckGo's redirect wrapper and then
 * put through exactly the same rules as a planner-supplied lookup URL: bounded
 * https(-or-http) only, public dotted hosts only, no credentials, no IP
 * literals, no private suffixes. Nothing a results page says can talk Cardea
 * into opening an address the lookup would have refused.
 */

/** Hard cap on the whole run: one search plus up to `maxPages` page reads. */
export const WEB_RESEARCH_TIMEOUT_MS = 45_000;

/** Hard cap on any single navigation inside that run. */
export const WEB_RESEARCH_NAVIGATION_TIMEOUT_MS = 12_000;

/**
 * Per-result excerpt bound. Smaller than the lookup's, because three of them
 * plus their titles and URLs share the one output budget.
 */
export const MAX_RESEARCH_EXCERPT_CHARS = 1_300;

/**
 * Cap on the Shopify enrichment block appended to the top result's own
 * excerpt (see `enrichTopResultWithShopify`). Bounded independently of
 * `MAX_RESEARCH_EXCERPT_CHARS` on purpose: that cap is already spent by the
 * scraped page text before this ever runs, so sharing one budget between
 * the two would starve whichever one is written second, always.
 */
export const MAX_SHOPIFY_BRIDGE_EXCERPT_CHARS = 1_300;

/** How many results a run may read. Clamped, never trusted from the plan. */
export const MAX_RESEARCH_PAGES = 3;
export const DEFAULT_RESEARCH_PAGES = 3;

const MIN_QUERY_CHARS = 3;
const MAX_QUERY_CHARS = 300;

/** Upper bound on the summary line, which is a UI string. */
const MAX_SUMMARY_CHARS = 160;

/** One place a query can be asked. `name` is for error text, never for a claim. */
export type SearchEngine = { name: string; searchUrl(query: string): string };

/**
 * The results pages Cardea searches, tried in this order until one answers
 * with something usable.
 *
 * DuckDuckGo's server-rendered `html.duckduckgo.com/html/` endpoint is first
 * because it needs no scripting at all: the results are anchors in the first
 * paint, so reading it involves no scrolling, no consent click, and no
 * interaction of any kind. Yahoo is second, and is there because search
 * engines are the least reliable thing in this whole path: probed from a real
 * Cloudflare Browser Run session, Brave, Ecosia and Startpage answer with
 * captchas, Mojeek returns 403, Marginalia returns a rate-limit interstitial,
 * and Bing answers with results for the wrong query. DuckDuckGo and Yahoo both
 * answered honestly, so those two are the chain.
 *
 * Bing is deliberately not in it. A degraded results page is worse than no
 * results: it would hand the planner confident evidence about something the
 * user never asked for.
 *
 * Nothing else in this design depends on which engine answered. Every anchor
 * is decoded, validated, and filtered by the same rules either way.
 */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    name: "duckduckgo",
    searchUrl: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  },
  {
    name: "yahoo",
    searchUrl: (query) => `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
  },
];

/** Invalid input: an unusable query is the caller's mistake, not a failure. */
export class WebResearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebResearchInputError";
  }
}

/** The run brought back nothing: the search failed, or no result could be read. */
export class WebResearchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebResearchFailedError";
  }
}

/**
 * Hosts that are the search engine itself rather than a result, and hosts that
 * only ever appear as a paid click-through. Matched on suffix, so subdomains
 * (`links.duckduckgo.com`, `r.search.yahoo.com`) are covered too.
 *
 * The two engine entries are here even though those engines run the search,
 * and that is the point: an organic result is unwrapped out of its redirect
 * before this filter sees it, so anything still on an engine host at this
 * stage is the site's own navigation, an image or maps tab, or an ad. None of
 * those is a result and none should be opened. `search.yahoo.com` rather than
 * `yahoo.com`, so a genuine result on `finance.yahoo.com` is not thrown away
 * with the chrome.
 *
 * This list is a quality filter, not a security boundary. The security
 * boundary is `validateLookupUrl`, which every candidate passes through
 * regardless of what is or is not named here.
 */
const NON_RESULT_HOST_SUFFIXES = [
  "duckduckgo.com",
  "duck.com",
  "search.yahoo.com",
  "bing.com",
  "googleadservices.com",
  "adservice.google.com",
  "doubleclick.net",
  "syndicatedsearch.goog",
  "amazon-adsystem.com",
];

/** One result the run either read or could not read. Never both, never faked. */
export type ResearchResult =
  | { url: string; title: string; excerpt: string; prices: string[]; ratings: string[] }
  | { url: string; error: string };

export type WebResearchInput = { query: string; maxPages: number };

/**
 * Reads and bounds the research input, in either shape a plan can carry.
 *
 * A bare string is the shape a real plan produces: the planner's structured
 * output carries one flat value per capability (see the schema note in
 * planner.ts), so the query arrives as that value.
 */
export function readResearchInput(input: JsonValue): WebResearchInput {
  const record =
    typeof input === "string"
      ? { query: input }
      : typeof input === "object" && input !== null && !Array.isArray(input)
        ? (input as Record<string, JsonValue>)
        : null;
  if (record === null) {
    throw new WebResearchInputError("web research needs a search query");
  }

  const raw = record.query;
  if (typeof raw !== "string") {
    throw new WebResearchInputError("web research needs a search query string");
  }
  const query = raw.replace(/\s+/g, " ").trim();
  if (query.length < MIN_QUERY_CHARS) {
    throw new WebResearchInputError(
      `web research needs a search query of at least ${MIN_QUERY_CHARS} characters`,
    );
  }
  if (query.length > MAX_QUERY_CHARS) {
    throw new WebResearchInputError(
      `web research query exceeds ${MAX_QUERY_CHARS} characters`,
    );
  }

  // Clamped rather than rejected: a plan asking for more pages than Cardea
  // will open is not wrong about what it wants, it is just over the bound.
  const requested = record.maxPages;
  const maxPages =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_RESEARCH_PAGES)
      : DEFAULT_RESEARCH_PAGES;

  return { query, maxPages };
}

/** The results-page URL for one query. The query is encoded, never interpolated raw. */
export function searchUrlFor(query: string, engine: SearchEngine = SEARCH_ENGINES[0]): string {
  return engine.searchUrl(query);
}

/** True when `host` is `suffix` or a subdomain of it. Never a substring match. */
function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Yahoo hides the destination in a path segment rather than a query parameter:
 * `/_ylt=.../RU=https%3a%2f%2fexample.com%2f/RK=2/RS=...`. The segment is
 * percent-encoded once.
 */
const YAHOO_REDIRECT_SEGMENT = /\/RU=([^/]+)/;

/**
 * Unwraps a search engine's click redirect to the page it actually points at.
 *
 * Both engines in the chain wrap their results, because a results page almost
 * never links straight at a result: DuckDuckGo uses
 * `duckduckgo.com/l/?uddg=<percent-encoded>` and Yahoo uses
 * `r.search.yahoo.com/.../RU=<percent-encoded>/...`. A direct anchor is
 * returned unchanged, and anything that is not a parseable URL, or is a
 * wrapper with no readable target, resolves to null.
 *
 * Whatever comes out is still only a candidate. Validation happens after this,
 * not inside it, so a wrapper that decodes to nonsense is refused by the URL
 * rules rather than needing to be caught here.
 */
export function resolveSearchHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (hostMatches(host, "duckduckgo.com") && url.pathname.startsWith("/l/")) {
    // `searchParams.get` performs the percent-decoding, so this is the real
    // target rather than an encoded one.
    const target = url.searchParams.get("uddg");
    if (typeof target !== "string" || target.trim().length === 0) return null;
    return target.trim();
  }

  if (hostMatches(host, "search.yahoo.com")) {
    const match = YAHOO_REDIRECT_SEGMENT.exec(url.pathname);
    if (!match) return null;
    try {
      const target = decodeURIComponent(match[1]).trim();
      return target.length > 0 ? target : null;
    } catch {
      return null;
    }
  }

  return href;
}

/** The host a result is deduped and reported by. `www.` is not a distinct site. */
function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The host named in a summary line. Falls back to the raw string rather than
 * inventing a host, so an unparseable URL reads as itself.
 */
function displayHost(raw: string): string {
  try {
    return normalizedHost(new URL(raw));
  } catch {
    return raw;
  }
}

/** One candidate result: a validated URL and the anchor text it was found under. */
export type SelectedResult = { url: string; host: string; text: string };

/**
 * Turns the anchors a results page offered into the pages this run will open.
 *
 * In order: decode the redirect, apply the lookup's URL rules, drop the search
 * engine's own hosts and the known ad click-through hosts, keep one result per
 * host, and stop at `limit`. Anything that fails any step is dropped silently,
 * because a results page is full of navigation, footers, and ads, and none of
 * those failing is an error worth reporting to the user.
 */
export function selectSearchResults(anchors: SearchAnchor[], limit: number): SelectedResult[] {
  const selected: SelectedResult[] = [];
  const seenHosts = new Set<string>();

  for (const anchor of anchors) {
    if (selected.length >= limit) break;

    const candidate = resolveSearchHref(anchor.href);
    if (candidate === null) continue;

    let url: URL;
    try {
      // The same rules a planner-supplied lookup URL must pass. A results page
      // gets no extra latitude just because a search engine printed the link.
      url = validateLookupUrl(candidate);
    } catch {
      continue;
    }

    const host = normalizedHost(url);
    if (NON_RESULT_HOST_SUFFIXES.some((suffix) => hostMatches(host, suffix))) continue;
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    selected.push({
      url: url.href,
      host,
      text: anchor.text.slice(0, MAX_SEARCH_LINK_TEXT_CHARS),
    });
  }

  return selected;
}

/** Whether a result was read, for the summary count and the zero-success check. */
function wasRead(
  result: ResearchResult,
): result is { url: string; title: string; excerpt: string; prices: string[]; ratings: string[] } {
  return "excerpt" in result;
}

/** A URL path shaped like a specific listing rather than a category or search page. */
const PRODUCT_PATH_PATTERN = /\/(product|products|item|itm|ip|dp|p)\//i;

/**
 * Ranks read results so the most specific, most decision-useful evidence
 * survives whatever downstream bounding happens next.
 *
 * This exists because two later consumers both take results in array order
 * without knowing which entry is actually worth keeping: the board opens the
 * first successful result as the live tile, and the consolidation step's
 * upstream-evidence digest is hard-capped in characters per node
 * (`execute-node.ts`), so entries past the cap are silently gone. Search
 * order is crawl order, not value order, and the product hop
 * (`selectProductLinks`) always runs last, appending the one or two pages
 * that actually carry a price and a specific item to the END of the array,
 * exactly where both consumers are least likely to reach them.
 *
 * A specific priced product page ranks above a priced-but-generic page,
 * which ranks above an unpriced read, which ranks above a page that could
 * not be read at all. Ties keep their relative crawl order (a stable sort),
 * so this reorders by usefulness without reshuffling within a tier. A
 * page's own observed rating counts the same as a price for this purpose:
 * both are the kind of concrete, decision-useful signal a category or
 * editorial page usually lacks.
 */
function resultRank(result: ResearchResult): number {
  if (!wasRead(result)) return 3;
  const isProductPage = PRODUCT_PATH_PATTERN.test(safePathOf(result.url));
  const hasConcreteSignal = result.prices.length > 0 || result.ratings.length > 0;
  if (isProductPage && hasConcreteSignal) return 0;
  if (isProductPage || hasConcreteSignal) return 1;
  return 2;
}

function safePathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

/**
 * Stable re-sort by {@link resultRank}. Exported so the board's tile picker
 * and the consolidation digest can both rely on "first" already meaning
 * "best", without either one needing its own notion of relevance.
 */
export function rankResearchResults(results: ResearchResult[]): ResearchResult[] {
  return results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => resultRank(a.result) - resultRank(b.result) || a.index - b.index)
    .map((entry) => entry.result);
}

/**
 * After ranking, the single most specific result — a real product page
 * already carrying an observed price or rating — is worth one extra check:
 * is this host actually a Shopify storefront? If it is, Cardea's own
 * Shopify capability adapter can return real structured catalog data (exact
 * price, variant ids, a cart-ready state) for that exact same store,
 * instead of only the scraped page text `web_research` already gathered.
 *
 * There is deliberately no separate "is this Shopify" probe first — the
 * simpler, cheaper design is to just attempt the real capability call and
 * let a non-Shopify host fail it, silently. `ShopifyCapabilityAdapter`
 * already refuses to run at all with no store configured, times out on its
 * own, and throws a typed error on anything that isn't a real Shopify MCP
 * response, so a bad guess costs at most one bounded network attempt, never
 * a hang and never a thrown error out of this function.
 *
 * Gated on the top result already being a specific, concrete find (a
 * product-shaped URL with an observed price or rating) rather than running
 * on every research call: a category page, a restaurant review, or any
 * other kind of research never reaches this, so the cost is paid only when
 * there is a real reason to suspect a purchasable product sits on this host.
 */
/**
 * Matches `SHOPIFY_CAPABILITY_IDS.catalogSearch` in `shopify-capability.ts`.
 * A literal, not an import: that module reaches a real Shopify credential
 * and env at load time, and this one only loads it lazily (see the dynamic
 * import below), the same discipline `loadLiveDeps` already uses in this
 * file for its own real-network dependencies.
 */
const SHOPIFY_CATALOG_SEARCH_CAPABILITY_ID = "shopify.catalog_search";

/** Test seam: real production always uses the dynamic import below. */
export type ShopifyBridgeCall = (
  request: CapabilityExecutionRequest,
) => Promise<CapabilityExecutionResult>;

async function defaultShopifyBridgeCall(
  request: CapabilityExecutionRequest,
): Promise<CapabilityExecutionResult> {
  const { ShopifyCapabilityAdapter } = await import("./shopify-capability");
  return new ShopifyCapabilityAdapter().execute(request);
}

export async function enrichTopResultWithShopify(
  results: ResearchResult[],
  context: { missionId: string; correlationId: string; query: string },
  deps: { call?: ShopifyBridgeCall } = {},
): Promise<ResearchResult[]> {
  const top = results.find(wasRead);
  if (!top) return results;
  const isSpecificProduct =
    PRODUCT_PATH_PATTERN.test(safePathOf(top.url)) && (top.prices.length > 0 || top.ratings.length > 0);
  if (!isSpecificProduct) return results;

  let host: string;
  try {
    host = new URL(top.url).hostname;
  } catch {
    return results;
  }

  try {
    const call = deps.call ?? defaultShopifyBridgeCall;
    const result = await call({
      capabilityId: SHOPIFY_CATALOG_SEARCH_CAPABILITY_ID,
      missionId: context.missionId,
      input: { query: context.query, store: host },
      correlationId: context.correlationId,
      idempotencyKey: `shopify-bridge:${context.correlationId}:${host}`,
    });
    const output = result.output as Record<string, unknown>;
    const rawExcerpt = typeof output.excerpt === "string" ? output.excerpt.trim() : "";
    if (!rawExcerpt) return results;
    // Bounded on its own, then concatenated without re-truncating the whole
    // thing: the scraped excerpt this result already carries is routinely
    // sitting right at MAX_RESEARCH_EXCERPT_CHARS already (results are
    // capped to it the moment they're read), so slicing the COMBINED text
    // back down to that same cap would silently throw away everything just
    // appended, every time, since the addition always comes after the part
    // that already fills the budget. Caught live, not assumed: the first
    // version of this did exactly that against a real Thuma product page.
    const shopifyExcerpt = rawExcerpt.slice(0, MAX_SHOPIFY_BRIDGE_EXCERPT_CHARS);
    return results.map((entry) =>
      entry === top
        ? {
            ...entry,
            excerpt: `${entry.excerpt}\n\n[Shopify storefront data for ${host}]\n${shopifyExcerpt}`,
          }
        : entry,
    );
  } catch {
    // Not Shopify, not configured, or the call failed outright: this was
    // always an optional enrichment on top of a research result that
    // already stands on its own. Never let it fail the research node.
    return results;
  }
}

/**
 * `Searched "<query>" and read 2 of 3 results: host, host`.
 *
 * Bounded to a UI-safe length by dropping hosts off the end, then truncating,
 * so the counts (which are the load-bearing part) always survive. No em dash,
 * per the product's copy rule.
 */
export function researchSummary(
  query: string,
  results: ResearchResult[],
  hosts: string[],
): string {
  const read = results.filter(wasRead).length;
  const head = `Searched "${query}" and read ${read} of ${results.length} results`;
  let line = hosts.length > 0 ? `${head}: ${hosts.join(", ")}` : head;
  if (line.length > MAX_SUMMARY_CHARS) {
    const trimmed = [...hosts];
    while (trimmed.length > 0 && line.length > MAX_SUMMARY_CHARS) {
      trimmed.pop();
      line = trimmed.length > 0 ? `${head}: ${trimmed.join(", ")}` : head;
    }
  }
  return line.slice(0, MAX_SUMMARY_CHARS);
}

/**
 * Keeps the serialized payload under `MAX_OUTPUT_BYTES` by shortening every
 * excerpt by the same factor, so no single result is starved to keep another
 * one whole. Bytes, not characters: a page of multi-byte text is several times
 * its own length on the wire.
 */
export function boundResearchOutput(payload: {
  query: string;
  results: ResearchResult[];
  sessionId: string;
}): JsonValue {
  // Starts from whichever is bigger: the normal per-result cap, or the
  // longest excerpt actually present. Every ordinary result is already at
  // or under MAX_RESEARCH_EXCERPT_CHARS by the time it gets here, so this
  // changes nothing for the common case; it only stops the Shopify-enriched
  // top result (deliberately longer, see enrichTopResultWithShopify) from
  // being clipped back down to the ordinary cap on the very first pass,
  // before the loop below ever checks whether the payload actually needs
  // to shrink. The loop still shrinks everything together, enriched or not,
  // if the combined payload is genuinely too big for MAX_OUTPUT_BYTES.
  const longestPresent = Math.max(
    MAX_RESEARCH_EXCERPT_CHARS,
    ...payload.results.filter(wasRead).map((result) => result.excerpt.length),
  );
  let limit = longestPresent;
  let candidate = withExcerptLimit(payload, limit);
  while (limit > 0 && Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_OUTPUT_BYTES) {
    limit = Math.floor(limit * 0.8);
    candidate = withExcerptLimit(payload, limit);
  }
  return candidate as unknown as JsonValue;
}

function withExcerptLimit(
  payload: { query: string; results: ResearchResult[]; sessionId: string },
  limit: number,
) {
  return {
    query: payload.query,
    results: payload.results.map((result) =>
      wasRead(result) ? { ...result, excerpt: result.excerpt.slice(0, limit) } : result,
    ),
    sessionId: payload.sessionId,
  };
}

const RESEARCH_DESCRIPTION = [
  "Searches the live web and reads the top results in Cardea's remote browser:",
  "give it the search phrase a person would type, including any place the user named, for example best florist delivery phoenix.",
  "Use this whenever the mission needs current options, reviews, prices, or availability and no exact page is known.",
  "Use cardea.web_lookup only when the user or an earlier brief names an exact page.",
  "Only include a place in the query when the goal or the constraints actually name one. Never guess where the person is.",
  "It returns each result's URL, title, and a bounded excerpt of its visible text. It cannot click, type, submit, or log in.",
].join(" ");

export class WebResearchAdapter implements CapabilityAdapter {
  // Distinct registry key: the registry keys adapters by provider and
  // rightly throws on duplicates, which took down planning when both
  // browser adapters claimed "cardea".
  readonly provider = "cardea-research";

  constructor(
    private readonly options: {
      enabled?: boolean;
      deps?: WebResearchDeps;
      /** Test seam only. Production always uses `WEB_RESEARCH_TIMEOUT_MS`. */
      timeoutMs?: number;
      /** Test seam only. Production always uses the navigation constant. */
      navigationTimeoutMs?: number;
    } = {},
  ) {}

  /** Gated on the remote browser exactly as the lookup is, and for the same reason. */
  private isEnabled(): boolean {
    if (this.options.enabled !== undefined) return this.options.enabled;
    if (this.options.deps) return true;
    return Boolean(
      process.env.CLOUDFLARE_BROWSER_TOKEN?.trim() && process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    );
  }

  async discover(): Promise<NormalizedCapability[]> {
    if (!this.isEnabled()) return [];
    return [
      {
        id: WEB_RESEARCH_CAPABILITY_ID,
        provider: this.provider,
        name: WEB_RESEARCH_CAPABILITY_ID,
        description: RESEARCH_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: MIN_QUERY_CHARS, maxLength: MAX_QUERY_CHARS },
            maxPages: { type: "integer", minimum: 1, maximum: MAX_RESEARCH_PAGES },
          },
          required: ["query"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            results: { type: "array" },
            sessionId: { type: "string" },
          },
        },
        risk: { level: "low", categories: ["read"] },
        // "derived" is the descriptor: the search-and-read function is
        // Cardea's own. The evidence it returns is untrusted, below.
        trust: { level: "derived", origin: WEB_LOOKUP_ORIGIN, provenance: "cardea:web_research" },
        readOnly: true,
      },
    ];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    if (request.capabilityId !== WEB_RESEARCH_CAPABILITY_ID) {
      throw new WebResearchInputError(
        `web research adapter cannot execute ${request.capabilityId}`,
      );
    }
    const { query, maxPages } = readResearchInput(request.input);
    const deps = this.options.deps ?? (await loadLiveDeps());
    const totalMs = this.options.timeoutMs ?? WEB_RESEARCH_TIMEOUT_MS;
    const navigationMs = this.options.navigationTimeoutMs ?? WEB_RESEARCH_NAVIGATION_TIMEOUT_MS;

    const session = await deps.createSession();
    let transport: CdpTransport | null = null;
    try {
      transport = await deps.connect(session);
      const work = runResearch(transport, query, maxPages, navigationMs, Date.now() + totalMs);
      const rankedResults = await withDeadline(
        work,
        totalMs,
        `web research timed out after ${totalMs}ms`,
      );
      const results = await enrichTopResultWithShopify(rankedResults, {
        missionId: request.missionId,
        correlationId: request.correlationId,
        query,
      });

      const hosts = results.filter(wasRead).map((result) => displayHost(result.url));
      return {
        executionId: request.idempotencyKey,
        output: boundResearchOutput({ query, results, sessionId: session.sessionId }),
        summary: researchSummary(query, results, hosts),
        // The search, not any one result: this run visited several hosts and
        // naming one of them would misdescribe where the evidence came from.
        provenance: "browser-run://cloudflare/search",
        // Text off pages nobody vetted, found by a ranking nobody controls.
        trust: "untrusted",
      };
    } finally {
      transport?.close();
      // Closed on every path, including a thrown timeout. A failed close is
      // Cloudflare's keep_alive to reap and must never mask the error on its
      // way out.
      await deps.closeSession(session.sessionId);
    }
  }
}

/**
 * The search-and-read sequence, over one attached page.
 *
 * Search failures are fatal: with no results there is nothing to read, and
 * returning an empty list would look like "the web has no answer" rather than
 * "Cardea could not run the search". Individual result failures are not: a
 * site that blocks headless browsers, times out, or serves an interstitial is
 * recorded as unreadable and the run continues, because two good sources are
 * worth more than an aborted run. Only zero successes throws.
 */
export async function runResearch(
  transport: CdpTransport,
  query: string,
  maxPages: number,
  navigationTimeoutMs: number,
  deadlineAt: number,
): Promise<ResearchResult[]> {
  const session = new CdpPageSession(transport);
  await session.attach();
  // Before any navigation. Without it Cloudflare's Chrome announces itself as
  // HeadlessChrome, and every search engine probed answers that token with a
  // captcha, a 403, or an empty document. This was measured, not assumed.
  await session.presentAsDesktopBrowser();

  const remaining = () => deadlineAt - Date.now();
  const budgetFor = () => Math.min(navigationTimeoutMs, Math.max(remaining(), 0));

  let selected: SelectedResult[] = [];
  let answered = false;
  let lastFailure: string | null = null;

  for (const engine of SEARCH_ENGINES) {
    if (remaining() <= 0) break;
    let anchors: SearchAnchor[] | null;
    try {
      await session.navigate(searchUrlFor(query, engine), budgetFor());
      anchors = readSearchLinksEvaluation(await session.evaluate(SEARCH_RESULT_LINKS_EXPRESSION));
    } catch (error) {
      lastFailure = `${engine.name}: ${error instanceof Error ? error.message : "unknown error"}`;
      continue;
    }
    if (anchors === null) {
      lastFailure = `${engine.name}: the results page returned nothing readable`;
      continue;
    }
    // The page answered. Whether it answered with anything worth opening is
    // the next question, and a captcha or an interstitial answers with none.
    answered = true;
    selected = selectSearchResults(anchors, maxPages);
    if (selected.length > 0) break;
  }

  if (selected.length === 0) {
    throw new WebResearchFailedError(
      answered
        ? `the search for "${query}" returned no usable results`
        : `the web search could not be run: ${lastFailure ?? "no search engine answered"}`,
    );
  }

  const results: ResearchResult[] = [];
  const productCandidates: { href: string; text: string }[] = [];
  for (const candidate of selected) {
    if (remaining() <= 0) {
      // Honest about why: this page was never opened, so calling it
      // unreadable would describe something that did not happen.
      results.push({ url: candidate.url, error: "out of time" });
      continue;
    }
    try {
      const read = await session.readPage(candidate.url, budgetFor());
      const excerpt = read.excerpt.trim();
      // A page that loaded but rendered no text is not evidence. Recording it
      // as a read result would put an empty excerpt in front of the planner
      // and let it look like the site had nothing to say.
      if (excerpt.length === 0) {
        results.push({ url: candidate.url, error: "unreadable" });
        continue;
      }
      results.push({
        url: read.finalUrl.length > 0 ? read.finalUrl : candidate.url,
        title: read.title.length > 0 ? read.title : candidate.text || candidate.host,
        excerpt: excerpt.slice(0, MAX_RESEARCH_EXCERPT_CHARS),
        prices: read.prices,
        ratings: read.ratings,
      });
      for (const link of read.links) productCandidates.push(link);
    } catch {
      results.push({ url: candidate.url, error: "unreadable" });
    }
  }

  // The product hop: editorial and category pages link to the actual
  // product pages, where prices, dimensions, and Add to cart live. Up to
  // two of the most product-shaped links are opened in the same session,
  // inside the same time budget, and recorded as ordinary read results.
  const hops = selectProductLinks(
    productCandidates,
    results.filter(wasRead).map((entry) => entry.url),
  );
  for (const hop of hops) {
    if (remaining() <= 0) break;
    try {
      const read = await session.readPage(hop.href, budgetFor());
      const excerpt = read.excerpt.trim();
      if (excerpt.length === 0) continue;
      const url = read.finalUrl.length > 0 ? read.finalUrl : hop.href;
      if (results.some((entry) => entry.url === url)) continue;
      results.push({
        url,
        title: read.title.length > 0 ? read.title : hop.text,
        excerpt: excerpt.slice(0, MAX_RESEARCH_EXCERPT_CHARS),
        prices: read.prices,
        ratings: read.ratings,
      });
    } catch {
      // A failed hop is silently skipped: the primary reads already stand,
      // and an unopened extra page is not evidence of anything.
    }
  }

  if (!results.some(wasRead)) {
    throw new WebResearchFailedError(
      `none of the ${results.length} results for "${query}" could be read`,
    );
  }
  // Ranked, not crawl-ordered: the product hop above appends the one or two
  // pages that actually carry a price and a specific item, and every
  // downstream consumer of this array (the board's tile picker, the
  // consolidation step's character-capped evidence digest) treats "first" as
  // "best". Without this, a generic category page that happened to load
  // first can push the actual find out of both.
  return rankResearchResults(results);
}

/** How many product pages the buying hop may open per run. */
export const MAX_PRODUCT_HOPS = 2;

const PRICEY_TEXT_PATTERN = /\$\s?\d/;

/**
 * Picks the most product-shaped outbound links from everything the primary
 * reads surfaced: a product-style path or a price in the anchor text,
 * excluding pages already read, search engines, ad hosts, and duplicate
 * hosts beyond two per host. Deterministic and bounded.
 */
export function selectProductLinks(
  candidates: { href: string; text: string }[],
  alreadyRead: string[],
): { href: string; text: string }[] {
  const read = new Set(alreadyRead);
  const perHost = new Map<string, number>();
  const chosen: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (chosen.length >= MAX_PRODUCT_HOPS) break;
    let url: URL;
    try {
      url = new URL(candidate.href);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    if (read.has(candidate.href) || seen.has(candidate.href)) continue;
    if (!PRODUCT_PATH_PATTERN.test(url.pathname) && !PRICEY_TEXT_PATTERN.test(candidate.text)) {
      continue;
    }
    if (
      NON_RESULT_HOST_SUFFIXES.some(
        (host: string) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    ) {
      continue;
    }
    const hostCount = perHost.get(url.hostname) ?? 0;
    if (hostCount >= 2) continue;
    perHost.set(url.hostname, hostCount + 1);
    seen.add(candidate.href);
    chosen.push(candidate);
  }
  return chosen;
}

/** Same shape as the lookup's, and satisfied by the same live wiring. */
export type WebResearchDeps = WebLookupDeps;

export const webResearchAdapter = new WebResearchAdapter();
