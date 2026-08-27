/**
 * Dependency-free JSON-RPC client for a Shopify storefront MCP endpoint.
 *
 * Deliberately imports nothing beyond `node:crypto` — no `server-only`, no SDK —
 * so it stays unit-testable under plain `node --test` against a fake fetch,
 * matching the convention `composio-support.ts` established.
 *
 * ---------------------------------------------------------------------------
 * Verified against live storefronts on 2026-08-26 (allbirds.com, gymshark.com)
 * ---------------------------------------------------------------------------
 *
 * TWO SURFACES EXIST, AND THE OLDER ONE IS ALREADY DYING.
 *
 * 1. `POST https://{store}/api/mcp` — the "legacy" storefront MCP surface.
 *    Public and unauthenticated. Responds today, but every response carries:
 *
 *        x-shopify-mcp-api-version: unstable
 *        deprecation: @1782259200
 *        sunset: Mon, 31 Aug 2026 00:00:00 GMT
 *        link: <https://shopify.dev/docs/agents>; rel="successor-version"
 *
 *    Tools: search_catalog, get_product_details, update_cart, get_cart,
 *    search_shop_policies_and_faqs.
 *
 * 2. `POST https://{store}/api/ucp/mcp` — the successor, implementing the
 *    Universal Commerce Protocol (UCP) v2026-04-08. Discoverable from
 *    `https://{store}/.well-known/ucp` under `ucp.services["dev.ucp.shopping"]`
 *    where `transport === "mcp"`.
 *
 *    Tools: search_catalog, lookup_catalog, get_product, create_cart,
 *    update_cart, get_cart, cancel_cart, AND the full checkout/order surface
 *    (create_checkout, update_checkout, complete_checkout, cancel_checkout,
 *    get_checkout, get_order).
 *
 * THAT is why {@link SHOPIFY_DENIED_TOOLS} is load-bearing rather than
 * decorative: the successor endpoint really does hand an agent
 * `complete_checkout`. Cardea's spike must never call it.
 *
 * UCP additionally gates *every* tool call — including read-only catalog
 * search — behind an agent profile URI that Shopify fetches server-side:
 *
 *     {"code":"profile_unreachable",
 *      "content":"Unable to fetch agent profile: Network error"}
 *
 * So the UCP surface cannot be exercised from localhost; it needs a publicly
 * reachable profile document (see `/api/integrations/shopify/agent-profile`).
 * The legacy surface needs no such thing, which is why it remains the default
 * until a deployment sets `CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL`.
 *
 * ---------------------------------------------------------------------------
 * Shopify constraints this module honors
 * ---------------------------------------------------------------------------
 *
 * Source: https://shopify.dev/docs/agents/catalog ("Usage guidelines"), which
 * governs both the Global and Storefront catalogs. Two rules are quotable and
 * binding:
 *
 *   "Don't cache or re-use images: Images may only be used in connection with
 *    the related merchant's product listing and must be rendered in real-time
 *    (not downloaded to servers)."
 *
 *   "Don't cache search results: Catalog results reflect merchant preferences
 *    on pricing, availability, and presentation. Caching results isn't allowed."
 *
 * CACHING. This client keeps no response cache. It sends `cache: "no-store"`,
 * holds nothing in memory between calls, and has no read-through path: every
 * capability invocation re-queries the storefront live. The wire agrees —
 * every observed response sets both `cache-control: no-cache, no-store` and
 * `cdn-cache-control: no-cache, no-store`.
 *
 *   Known gray area, recorded rather than glossed: Cardea persists a bounded
 *   *excerpt* of each result as an `evidence.recorded` mission event. That is a
 *   provenance record of what the agent observed at a timestamp — it is never
 *   read back to answer a later query, never served as catalog data, and never
 *   substitutes for a live call. It is nonetheless persisted result text, so
 *   BE-10's status section flags it explicitly as the one compliance question a
 *   reviewer should rule on before any public claim is made.
 *
 * IMAGERY. Catalog and cart payloads carry merchant media as `cdn.shopify.com`
 * URLs (`media[].url`, `line_items[].item.image_url`). Cardea never fetches,
 * proxies, re-hosts, or downloads those images: the URL survives only as text
 * inside the excerpt, and the canvas renders that excerpt as plain text rather
 * than as `<img>` tags. Nothing here puts an image byte on a Cardea server.
 *
 * RATE LIMITS. Shopify publishes no numeric quota for these endpoints, and
 * states that "Keyless catalog access doesn't support rate limit increases."
 * Limits scale with identification (Token > Signed > Anonymous); Cardea is
 * anonymous, so it sits on the lowest tier and must be frugal. Responses carry
 * `shopify-complexity-score` / `shopify-complexity-score-v2` (observed 35–41
 * for `tools/list`) but no `X-RateLimit-*` headers. This client therefore stays
 * conservative: one hard timeout, at most {@link SHOPIFY_MAX_RETRIES} retries,
 * retries only genuinely retryable failures, exponential backoff, and no
 * polling anywhere.
 */
import { createHash } from "node:crypto";

/* -------------------------------------------------------------------------- */
/* Transport surfaces                                                         */
/* -------------------------------------------------------------------------- */

export type ShopifySurface = "legacy" | "ucp";

export const SHOPIFY_SURFACE_PATHS: Readonly<Record<ShopifySurface, string>> = {
  legacy: "/api/mcp",
  ucp: "/api/ucp/mcp",
};

/**
 * Tools Cardea is willing to call, per surface.
 *
 * An allowlist, never a denylist-by-omission: a tool that appears on the
 * storefront but not here is simply unreachable through this adapter.
 */
export const SHOPIFY_ALLOWED_TOOLS: Readonly<Record<ShopifySurface, readonly string[]>> = {
  legacy: ["search_catalog", "get_product_details", "update_cart", "get_cart"],
  ucp: ["search_catalog", "get_product", "create_cart", "update_cart", "get_cart"],
};

/**
 * Tools that must never be surfaced or invoked, even if a storefront
 * advertises them and even if a caller names one explicitly.
 *
 * These are real tool names observed on the live UCP endpoint. `complete_checkout`
 * places an order; the rest either move money, bind a buyer identity, or read
 * order history. The ticket's scope is catalog + reversible cart preparation,
 * and final checkout is handed to the human.
 */
export const SHOPIFY_DENIED_TOOLS: readonly string[] = [
  "create_checkout",
  "update_checkout",
  "complete_checkout",
  "cancel_checkout",
  "get_checkout",
  "get_order",
];

/**
 * Argument keys that must never leave Cardea for a Shopify endpoint.
 *
 * The live `update_cart` / `create_cart` schemas accept buyer email, phone, and
 * full delivery addresses. Cardea's spike does no customer accounts and no
 * payment, so it strips these rather than trusting callers not to send them.
 */
export const SHOPIFY_FORBIDDEN_ARGUMENT_KEYS: readonly string[] = [
  "buyer",
  "buyer_identity",
  "delivery_addresses_to_add",
  "delivery_addresses_to_replace",
  "selected_delivery_options",
  "payment",
  "payment_data",
  "gift_card_codes",
];

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The legacy surface's own advertised end-of-life, surfaced verbatim so the
 * canvas and the ticket can state it rather than imply it.
 */
export const SHOPIFY_LEGACY_SUNSET = "2026-08-31";

export const SHOPIFY_LEGACY_DEPRECATION_NOTE =
  `This store is being read over Shopify's legacy /api/mcp surface, which advertises ` +
  `"x-shopify-mcp-api-version: unstable" and sunsets ${SHOPIFY_LEGACY_SUNSET}. Set ` +
  `CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL to a publicly reachable https profile to move to the ` +
  `supported UCP surface (/api/ucp/mcp) before then.`;

export type ShopifyConfig = {
  storeDomain: string;
  surface: ShopifySurface;
  endpoint: string;
  /** Only set for the UCP surface, which refuses to serve without it. */
  agentProfileUrl: string | null;
  /** Non-null when the selected surface is on a published end-of-life path. */
  deprecation: string | null;
};

export type ShopifyConfigResolution =
  | { configured: true; config: ShopifyConfig }
  | { configured: false; reason: string };

/** Rejects anything that is not a bare hostname: no scheme, port, path, or wildcard. */
function normalizeStoreDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Resolves Shopify configuration from the environment.
 *
 * Absent `CARDEA_SHOPIFY_STORE_DOMAIN` is the normal, expected state: the
 * feature reports not-configured, discovery returns nothing, and no other
 * behavior anywhere changes. It never throws.
 */
export function resolveShopifyConfig(
  env: Record<string, string | undefined> = process.env,
): ShopifyConfigResolution {
  const raw = env.CARDEA_SHOPIFY_STORE_DOMAIN;
  if (!raw || raw.trim() === "") {
    return {
      configured: false,
      reason:
        "No Shopify store is configured. Set CARDEA_SHOPIFY_STORE_DOMAIN to a storefront domain to enable this capability.",
    };
  }
  const storeDomain = normalizeStoreDomain(raw);
  if (!storeDomain) {
    return {
      configured: false,
      reason:
        "CARDEA_SHOPIFY_STORE_DOMAIN must be a bare storefront hostname such as example.com, with no scheme, port, or path.",
    };
  }

  const agentProfileUrl = env.CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL?.trim() || null;
  if (agentProfileUrl && !/^https:\/\/[^\s]+$/i.test(agentProfileUrl)) {
    return {
      configured: false,
      reason: "CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL must be an absolute https URL.",
    };
  }

  const requested = env.CARDEA_SHOPIFY_MCP_SURFACE?.trim().toLowerCase();
  if (requested && requested !== "legacy" && requested !== "ucp") {
    return {
      configured: false,
      reason: 'CARDEA_SHOPIFY_MCP_SURFACE must be either "legacy" or "ucp".',
    };
  }

  // UCP is the successor surface and the only one with a future, but it refuses
  // every call without a publicly fetchable agent profile. Choosing it
  // automatically when that URL is present keeps a deployed Cardea on the
  // supported path while a local checkout still works on the legacy surface.
  const surface: ShopifySurface = (requested as ShopifySurface | undefined) ?? (agentProfileUrl ? "ucp" : "legacy");

  if (surface === "ucp" && !agentProfileUrl) {
    return {
      configured: false,
      reason:
        "The UCP surface requires CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL to be a publicly reachable https URL, because Shopify fetches it server-side before serving any tool call.",
    };
  }

  return {
    configured: true,
    config: {
      storeDomain,
      surface,
      endpoint: `https://${storeDomain}${SHOPIFY_SURFACE_PATHS[surface]}`,
      agentProfileUrl: surface === "ucp" ? agentProfileUrl : null,
      deprecation: surface === "legacy" ? SHOPIFY_LEGACY_DEPRECATION_NOTE : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ShopifyFailureReason =
  | "not_configured"
  | "tool_not_allowed"
  | "checkout_tool_refused"
  | "invalid_input"
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "malformed_response";

export class ShopifyMcpError extends Error {
  readonly reason: ShopifyFailureReason;
  readonly retryable: boolean;

  constructor(reason: ShopifyFailureReason, detail?: string) {
    super(`Shopify storefront MCP unavailable: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ShopifyMcpError";
    this.reason = reason;
    this.retryable = reason === "timeout" || reason === "rate_limited" || reason === "upstream_error";
  }
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

export const SHOPIFY_EVIDENCE_EXCERPT_BYTE_CAP = 4_000;

/**
 * Mirrors `ComposioEvidence` field-for-field so both external providers land in
 * the mission log through one recognisable shape. `provider` is just a string;
 * nothing downstream special-cases "shopify".
 */
export type ShopifyEvidence = {
  origin: string;
  provider: "shopify";
  storeDomain: string;
  toolSlug: string;
  digestSha256: string;
  excerpt: string;
  bytes: number;
  truncated: boolean;
  trust: "untrusted";
  capturedAt: string;
};

/** Caps a UTF-8 string on a character boundary, never mid-codepoint. */
function capUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  let end = maxBytes;
  // Walk back off any UTF-8 continuation byte (0b10xxxxxx) so the slice decodes cleanly.
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return { text: buffer.subarray(0, end).toString("utf8"), truncated: true };
}

/**
 * Converts a raw storefront payload into bounded, provenance-tagged, untrusted
 * evidence: origin, sha-256 over the *full* payload, and a byte-capped excerpt.
 *
 * Catalog copy is merchant-authored text on the open internet. It is evidence,
 * never instruction — the digest lets a reviewer prove what was seen without
 * the full payload ever entering a prompt.
 */
export function buildShopifyEvidence(options: {
  storeDomain: string;
  tool: string;
  payload: unknown;
  now?: Date;
}): ShopifyEvidence {
  const serialized =
    typeof options.payload === "string" ? options.payload : JSON.stringify(options.payload ?? {});
  const buffer = Buffer.from(serialized, "utf8");
  const digestSha256 = createHash("sha256").update(buffer).digest("hex");
  const capped = capUtf8(serialized, SHOPIFY_EVIDENCE_EXCERPT_BYTE_CAP);
  return {
    origin: `https://${options.storeDomain}`,
    provider: "shopify",
    storeDomain: options.storeDomain,
    toolSlug: options.tool,
    digestSha256,
    excerpt: capped.text,
    bytes: buffer.byteLength,
    truncated: capped.truncated,
    trust: "untrusted",
    capturedAt: (options.now ?? new Date()).toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Structured references                                                      */
/* -------------------------------------------------------------------------- */

export const SHOPIFY_MAX_REFS = 25;

/**
 * The bounded, structured identifiers a caller needs to chain one storefront
 * call into the next.
 *
 * WHY THIS EXISTS. The evidence excerpt is byte-capped, so on any real catalog
 * response it is truncated mid-JSON and cannot be parsed. That is correct for
 * evidence — it is a quotable record, not a data feed — but it would make the
 * capability useless: you could search and never learn a product id to look up,
 * or prepare a cart and never learn its id to read back.
 *
 * So identifiers are extracted from the *full* payload before capping and
 * returned separately. They are deliberately the least expressive thing that
 * makes chaining work: opaque ids and the storefront's own handoff URL. No
 * prices, no descriptions, no imagery, nothing a model could mistake for a
 * verified fact. The evidence excerpt remains the only content surface.
 */
export type ShopifyRefs = {
  productIds: string[];
  variantIds: string[];
  cartId: string | null;
  lineIds: string[];
  /** The storefront's own URL for a human to finish checkout themselves. */
  continueUrl: string | null;
};

/**
 * Walks a payload collecting Shopify GIDs and the cart handoff URL.
 *
 * Bounded on every axis — depth, node count, and per-list length — so a hostile
 * or merely enormous response cannot turn extraction into a denial of service.
 */
export function extractShopifyRefs(payload: unknown): ShopifyRefs {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  const lineIds = new Set<string>();
  let cartId: string | null = null;
  let continueUrl: string | null = null;
  let visited = 0;

  const walk = (value: unknown, depth: number): void => {
    if (visited > 5_000 || depth > 12 || value === null || typeof value !== "object") return;
    visited += 1;

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string") {
        if (entry.startsWith("gid://shopify/Product/")) productIds.add(entry);
        else if (entry.startsWith("gid://shopify/ProductVariant/")) variantIds.add(entry);
        else if (entry.startsWith("gid://shopify/CartLine/")) lineIds.add(entry);
        else if (entry.startsWith("gid://shopify/Cart/")) cartId ??= entry;
        else if (key === "continue_url" || key === "checkout_url") continueUrl ??= entry.slice(0, 2_000);
        continue;
      }
      walk(entry, depth + 1);
    }
  };

  walk(payload, 0);

  return {
    productIds: [...productIds].slice(0, SHOPIFY_MAX_REFS),
    variantIds: [...variantIds].slice(0, SHOPIFY_MAX_REFS),
    cartId,
    lineIds: [...lineIds].slice(0, SHOPIFY_MAX_REFS),
    continueUrl,
  };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

export const SHOPIFY_TIMEOUT_MS = 12_000;
export const SHOPIFY_MAX_RETRIES = 2;
export const SHOPIFY_MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Structural view of `fetch`. Declared narrowly so a test can pass a plain
 * function and so this module never depends on DOM lib types.
 */
export type ShopifyFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
    cache?: "no-store";
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Strips argument keys Cardea refuses to transmit, at any nesting depth. */
export function stripForbiddenArguments(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => stripForbiddenArguments(entry, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SHOPIFY_FORBIDDEN_ARGUMENT_KEYS.includes(key)) continue;
    output[key] = stripForbiddenArguments(entry, depth + 1);
  }
  return output;
}

/**
 * Asserts a tool name is callable on this surface.
 *
 * Checkout tools get their own reason so the refusal is legible in an audit
 * trail rather than blurred into a generic "not allowed".
 */
export function assertToolAllowed(surface: ShopifySurface, tool: string): void {
  if (SHOPIFY_DENIED_TOOLS.includes(tool)) {
    throw new ShopifyMcpError("checkout_tool_refused", tool);
  }
  if (!SHOPIFY_ALLOWED_TOOLS[surface].includes(tool)) {
    throw new ShopifyMcpError("tool_not_allowed", tool);
  }
}

function backoffMs(attempt: number): number {
  const exponential = Math.min(2_000, 250 * 2 ** attempt);
  return exponential - Math.floor(Math.random() * (exponential / 2));
}

/** Pulls the UCP/MCP payload out of a `tools/call` result, preferring structured output. */
function extractPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;

  // UCP MCP servers MUST return the payload in `structuredContent` and SHOULD
  // also mirror it as serialized JSON in `content[]` for older clients.
  if (record.structuredContent !== undefined) return record.structuredContent;

  const content = record.content;
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (part): part is { type: string; text: string } =>
          !!part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text);

    // Parse each part INDEPENDENTLY and take the first that is JSON.
    //
    // Not merely defensive: the live legacy endpoint really does return two
    // text parts — the JSON payload, then a plain-text banner reading
    // "DEPRECATION NOTICE: This tool is served by the Storefront MCP server at
    // /api/mcp and will no longer be accessible after August 31, 2026."
    // Concatenating them yields invalid JSON, which would silently degrade the
    // payload to an opaque string and strip every chainable id from `refs`.
    for (const part of parts) {
      try {
        return JSON.parse(part) as unknown;
      } catch {
        // Not this part; keep looking.
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return record;
}

export type ShopifyCallOptions = {
  config: ShopifyConfig;
  tool: string;
  args: Record<string, unknown>;
  fetchImpl?: ShopifyFetch;
  now?: () => Date;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable so tests never actually sleep. */
  sleep?: (ms: number) => Promise<void>;
};

export type ShopifyCallResult = {
  evidence: ShopifyEvidence;
  /** Bounded ids extracted from the full payload, so calls can be chained. */
  refs: ShopifyRefs;
  /** Shopify's own cost signal for this call, when it sent one. */
  complexityScore: number | null;
};

/**
 * Calls one allowlisted storefront tool over JSON-RPC 2.0 and returns bounded
 * untrusted evidence.
 *
 * Every failure is a typed {@link ShopifyMcpError}; nothing is ever synthesized
 * to paper over an unreachable storefront.
 */
export async function callShopifyTool(options: ShopifyCallOptions): Promise<ShopifyCallResult> {
  const { config, tool } = options;
  assertToolAllowed(config.surface, tool);

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as ShopifyFetch);
  if (typeof fetchImpl !== "function") {
    throw new ShopifyMcpError("upstream_error", "no fetch implementation available");
  }
  const timeoutMs = options.timeoutMs ?? SHOPIFY_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? SHOPIFY_MAX_RETRIES;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const safeArgs = stripForbiddenArguments(options.args) as Record<string, unknown>;
  // UCP requires the agent profile on every single call, including reads.
  const args =
    config.surface === "ucp" && config.agentProfileUrl
      ? { meta: { "ucp-agent": { profile: config.agentProfileUrl } }, ...safeArgs }
      : safeArgs;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });

  let lastError: ShopifyMcpError = new ShopifyMcpError("upstream_error", "no attempt completed");

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The endpoint may answer as JSON or as an SSE stream; advertise both.
          Accept: "application/json, text/event-stream",
        },
        body,
        signal: controller.signal,
        // Shopify marks these responses no-store; never let a fetch layer cache them.
        cache: "no-store",
      });

      const complexityRaw =
        response.headers.get("shopify-complexity-score-v2") ??
        response.headers.get("shopify-complexity-score");
      const complexityScore = complexityRaw === null ? null : Number(complexityRaw);

      if (!response.ok) {
        const reason: ShopifyFailureReason =
          response.status === 429
            ? "rate_limited"
            : response.status >= 500
              ? "upstream_error"
              : "invalid_input";
        lastError = new ShopifyMcpError(reason, `http ${response.status}`);
        if (!lastError.retryable || attempt === maxRetries) throw lastError;
        await sleep(backoffMs(attempt));
        continue;
      }

      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > SHOPIFY_MAX_RESPONSE_BYTES) {
        throw new ShopifyMcpError("malformed_response", "response exceeded byte ceiling");
      }

      let envelope: { result?: unknown; error?: { code?: number; message?: string } };
      try {
        envelope = JSON.parse(raw) as typeof envelope;
      } catch {
        throw new ShopifyMcpError("malformed_response", "body was not JSON");
      }

      if (envelope.error) {
        // JSON-RPC application errors (bad arguments, UCP discovery failure) are
        // terminal: retrying an identical request cannot change the outcome.
        throw new ShopifyMcpError("invalid_input", envelope.error.message ?? "jsonrpc error");
      }
      if (envelope.result === undefined) {
        throw new ShopifyMcpError("malformed_response", "envelope had neither result nor error");
      }

      // Extract ids from the FULL payload before the excerpt is capped;
      // afterwards the truncated excerpt is no longer parseable JSON.
      const payload = extractPayload(envelope.result);
      return {
        evidence: buildShopifyEvidence({
          storeDomain: config.storeDomain,
          tool,
          payload,
          now: options.now?.(),
        }),
        refs: extractShopifyRefs(payload),
        complexityScore: Number.isFinite(complexityScore) ? complexityScore : null,
      };
    } catch (error) {
      if (error instanceof ShopifyMcpError) {
        lastError = error;
        if (!error.retryable || attempt === maxRetries) throw error;
      } else {
        const aborted =
          (error as { name?: string } | null)?.name === "AbortError" ||
          (error as { name?: string } | null)?.name === "TimeoutError";
        lastError = new ShopifyMcpError(
          aborted ? "timeout" : "upstream_error",
          aborted ? `exceeded ${timeoutMs}ms` : "network failure",
        );
        if (attempt === maxRetries) throw lastError;
      }
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
