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
  MAX_TARGET_URL_LENGTH,
  type CdpTransport,
  type PageRead,
  attachToTargetCommand,
  createCdpEncoder,
  decodeCdpMessage,
  encodeCdpCommand,
  evaluateCommand,
  navigateCommand,
  pageEnableCommand,
  PAGE_READ_EXPRESSION,
  readPageEvaluation,
  runtimeEnableCommand,
  validateTargetUrl,
} from "../../core/browser-run/protocol";
import {
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_LOOKUP_ORIGIN,
} from "../../core/contracts/safe-capabilities";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";

export { WEB_LOOKUP_CAPABILITY_ID, WEB_LOOKUP_ORIGIN };

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
 * Drives one page read over an already-connected CDP transport.
 *
 * Target.getTargets -> attach (flat) -> Page.enable -> Runtime.enable ->
 * Page.navigate -> Page.loadEventFired -> Runtime.evaluate.
 *
 * The single deadline covers the whole sequence, so a page that connects and
 * then never loads fails the same way as one that never connects. Every exit
 * runs through `fail`/`finish` exactly once, so a late reply after a timeout
 * cannot resolve an already-rejected read.
 */
export function readPageOverCdp(
  transport: CdpTransport,
  targetUrl: string,
  timeoutMs: number = WEB_LOOKUP_TIMEOUT_MS,
): Promise<PageRead> {
  return new Promise<PageRead>((resolve, reject) => {
    const encoder = createCdpEncoder();
    const pending = new Map<number, (result: Record<string, unknown>) => void>();
    let settled = false;
    let targetSessionId: string | null = null;
    let evaluated = false;

    const timer = setTimeout(() => {
      fail(new WebLookupFailedError(`web lookup timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(value: PageRead) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    function call(
      command: ReturnType<typeof encoder.command>,
      onResult?: (result: Record<string, unknown>) => void,
    ) {
      if (onResult) pending.set(command.id, onResult);
      try {
        transport.send(encodeCdpCommand(command));
      } catch {
        fail(new WebLookupFailedError("the remote browser connection dropped mid-read"));
      }
    }

    function evaluatePage() {
      // The load event and the navigate reply can both land; only the first
      // one to arrive gets to trigger the read.
      if (evaluated || settled || targetSessionId === null) return;
      evaluated = true;
      call(evaluateCommand(encoder, targetSessionId, PAGE_READ_EXPRESSION), (result) => {
        const read = readPageEvaluation(result);
        if (!read) {
          fail(new WebLookupFailedError("the page returned no readable text"));
          return;
        }
        finish(read);
      });
    }

    function attach(targetId: string) {
      call(attachToTargetCommand(encoder, targetId), (result) => {
        const sessionId = result.sessionId;
        if (typeof sessionId !== "string") {
          fail(new WebLookupFailedError("could not attach to a page in the remote browser"));
          return;
        }
        targetSessionId = sessionId;
        call(pageEnableCommand(encoder, sessionId));
        call(runtimeEnableCommand(encoder, sessionId));
        call(navigateCommand(encoder, sessionId, targetUrl), (navResult) => {
          const errorText = navResult.errorText;
          if (typeof errorText === "string" && errorText.length > 0) {
            fail(new WebLookupFailedError(`navigation failed: ${errorText}`));
          }
          // Otherwise wait for Page.loadEventFired; the deadline is the only
          // thing that ends this wait early.
        });
      });
    }

    transport.onError((error) => fail(new WebLookupFailedError(error.message)));
    transport.onClose(() => {
      fail(new WebLookupFailedError("the remote browser closed before the page was read"));
    });

    transport.onMessage((raw) => {
      const message = decodeCdpMessage(raw);
      if (!message) return;

      if (message.kind === "result") {
        const onResult = pending.get(message.id);
        pending.delete(message.id);
        onResult?.(message.result);
        return;
      }
      if (message.kind === "error") {
        pending.delete(message.id);
        fail(new WebLookupFailedError(`the remote browser refused a command: ${message.message}`));
        return;
      }
      if (message.method === "Page.loadEventFired") evaluatePage();
    });

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
          fail(new WebLookupFailedError("the remote browser had no page to open"));
          return;
        }
        attach(targetId);
      });
    });
  });
}

const DESCRIPTION = [
  "Opens one public webpage in Cardea's remote browser and reads it.",
  "Input: the full URL to open, as a string (or { url }).",
  "Use it to look at real listings, prices, schedules, timetables, documentation, and articles instead of recalling them.",
  "Give one specific full URL, prefer well-known public sites, and never a page that requires a login, a cookie banner dismissal, or a form submission.",
  "It returns the page title and a bounded excerpt of the page's visible text. It cannot click, type, submit, or follow a second page.",
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
        description: DESCRIPTION,
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
 * The live wiring, loaded only when no deps were injected. Both modules below
 * are `server-only` and reach a real credential and a real socket, which is
 * exactly why this import is lazy: importing them at module scope would make
 * this file unloadable in a plain `node --test` process.
 */
async function loadLiveDeps(): Promise<WebLookupDeps> {
  const cloudflare = await import("../../lib/browser-run/cloudflare");
  const socket = await import("../../lib/browser-run/cdp-socket");
  return {
    createSession: () => cloudflare.createSession(),
    connect: (session) => socket.connectCdpTransport(session.webSocketDebuggerUrl),
    closeSession: async (sessionId) => {
      await cloudflare.closeSession(sessionId);
    },
  };
}

export const webLookupAdapter = new WebLookupAdapter();
