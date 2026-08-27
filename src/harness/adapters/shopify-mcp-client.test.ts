import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertToolAllowed,
  buildShopifyEvidence,
  callShopifyTool,
  extractShopifyRefs,
  resolveShopifyConfig,
  SHOPIFY_DENIED_TOOLS,
  SHOPIFY_EVIDENCE_EXCERPT_BYTE_CAP,
  SHOPIFY_MAX_REFS,
  ShopifyMcpError,
  stripForbiddenArguments,
  type ShopifyConfig,
  type ShopifyFetch,
} from "./shopify-mcp-client";

const legacyConfig: ShopifyConfig = {
  storeDomain: "example-store.com",
  surface: "legacy",
  endpoint: "https://example-store.com/api/mcp",
  agentProfileUrl: null,
  deprecation: "legacy",
};

const ucpConfig: ShopifyConfig = {
  storeDomain: "example-store.com",
  surface: "ucp",
  endpoint: "https://example-store.com/api/ucp/mcp",
  agentProfileUrl: "https://cardea.example/agent-profile",
  deprecation: null,
};

type Capture = { url: string; body: string; headers: Record<string, string> };

/** A fake fetch that records the request and replays a canned JSON-RPC envelope. */
function fakeFetch(
  envelope: unknown,
  capture: Capture[] = [],
  init: { status?: number; headers?: Record<string, string>; raw?: string } = {},
): ShopifyFetch {
  return async (url, request) => {
    capture.push({ url, body: request.body, headers: request.headers });
    const headers = init.headers ?? {};
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => init.raw ?? JSON.stringify(envelope),
    };
  };
}

const noSleep = async () => {};

/* -------------------------------------------------------------------------- */
/* Configuration gating                                                       */
/* -------------------------------------------------------------------------- */

test("reports not-configured when no store domain is set, and never throws", () => {
  const resolution = resolveShopifyConfig({});
  assert.equal(resolution.configured, false);
  assert.match(resolution.configured ? "" : resolution.reason, /CARDEA_SHOPIFY_STORE_DOMAIN/);
});

test("an empty store domain is treated as absent rather than as a broken config", () => {
  assert.equal(resolveShopifyConfig({ CARDEA_SHOPIFY_STORE_DOMAIN: "   " }).configured, false);
});

test("rejects a store domain carrying a scheme, path, or wildcard", () => {
  for (const value of [
    "https://example.com",
    "example.com/api/mcp",
    "*.example.com",
    "example.com:443",
    "localhost",
  ]) {
    assert.equal(
      resolveShopifyConfig({ CARDEA_SHOPIFY_STORE_DOMAIN: value }).configured,
      false,
      `expected ${value} to be refused`,
    );
  }
});

test("defaults to the legacy surface and records its published sunset", () => {
  const resolution = resolveShopifyConfig({ CARDEA_SHOPIFY_STORE_DOMAIN: "Example-Store.com" });
  assert.ok(resolution.configured);
  assert.equal(resolution.config.surface, "legacy");
  // Domain is normalized to lowercase so the endpoint is stable.
  assert.equal(resolution.config.endpoint, "https://example-store.com/api/mcp");
  assert.match(resolution.config.deprecation ?? "", /2026-08-31/);
});

test("moves to the UCP surface once a public agent profile URL exists", () => {
  const resolution = resolveShopifyConfig({
    CARDEA_SHOPIFY_STORE_DOMAIN: "example-store.com",
    CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL: "https://cardea.example/agent-profile",
  });
  assert.ok(resolution.configured);
  assert.equal(resolution.config.surface, "ucp");
  assert.equal(resolution.config.endpoint, "https://example-store.com/api/ucp/mcp");
  assert.equal(resolution.config.deprecation, null);
});

test("refuses the UCP surface without a profile, because Shopify refuses every call without one", () => {
  const resolution = resolveShopifyConfig({
    CARDEA_SHOPIFY_STORE_DOMAIN: "example-store.com",
    CARDEA_SHOPIFY_MCP_SURFACE: "ucp",
  });
  assert.equal(resolution.configured, false);
  assert.match(resolution.configured ? "" : resolution.reason, /publicly reachable/);
});

/* -------------------------------------------------------------------------- */
/* Tool allowlisting                                                          */
/* -------------------------------------------------------------------------- */

test("allows only the reviewed catalog and cart tools", () => {
  assert.doesNotThrow(() => assertToolAllowed("legacy", "search_catalog"));
  assert.doesNotThrow(() => assertToolAllowed("ucp", "create_cart"));
  // Real UCP tool, but not one Cardea reviewed.
  assert.throws(
    () => assertToolAllowed("ucp", "cancel_cart"),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "tool_not_allowed",
  );
  // create_cart exists only on UCP; naming it on legacy must not slip through.
  assert.throws(
    () => assertToolAllowed("legacy", "create_cart"),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "tool_not_allowed",
  );
});

test("refuses every checkout, payment, and order tool by name on both surfaces", () => {
  assert.ok(SHOPIFY_DENIED_TOOLS.includes("complete_checkout"));
  for (const surface of ["legacy", "ucp"] as const) {
    for (const tool of SHOPIFY_DENIED_TOOLS) {
      assert.throws(
        () => assertToolAllowed(surface, tool),
        (error: unknown) =>
          error instanceof ShopifyMcpError && error.reason === "checkout_tool_refused",
        `${tool} must be refused on ${surface}`,
      );
    }
  }
});

test("a refused checkout tool never reaches the network", async () => {
  const capture: Capture[] = [];
  await assert.rejects(
    () =>
      callShopifyTool({
        config: ucpConfig,
        tool: "complete_checkout",
        args: {},
        fetchImpl: fakeFetch({}, capture),
        sleep: noSleep,
      }),
    (error: unknown) =>
      error instanceof ShopifyMcpError && error.reason === "checkout_tool_refused",
  );
  assert.equal(capture.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Argument stripping                                                         */
/* -------------------------------------------------------------------------- */

test("strips buyer identity, addresses, and payment keys at any depth", () => {
  const stripped = stripForbiddenArguments({
    cart_id: "c1",
    buyer_identity: { email: "person@example.com" },
    cart: {
      line_items: [{ quantity: 1 }],
      buyer: { email: "person@example.com", phone_number: "555" },
      delivery_addresses_to_add: [{ zip: "94110" }],
    },
    payment: { token: "tok" },
  }) as Record<string, unknown>;

  assert.deepEqual(stripped, { cart_id: "c1", cart: { line_items: [{ quantity: 1 }] } });
  assert.equal(JSON.stringify(stripped).includes("person@example.com"), false);
});

test("no buyer PII survives into the transmitted request body", async () => {
  const capture: Capture[] = [];
  await callShopifyTool({
    config: legacyConfig,
    tool: "update_cart",
    args: { cart_id: "c1", buyer_identity: { email: "person@example.com" } },
    fetchImpl: fakeFetch({ jsonrpc: "2.0", id: 1, result: { content: [] } }, capture),
    sleep: noSleep,
  });
  assert.equal(capture[0].body.includes("person@example.com"), false);
  assert.equal(capture[0].body.includes("buyer_identity"), false);
});

/* -------------------------------------------------------------------------- */
/* Envelope construction                                                      */
/* -------------------------------------------------------------------------- */

test("builds a JSON-RPC 2.0 tools/call envelope against the configured endpoint", async () => {
  const capture: Capture[] = [];
  await callShopifyTool({
    config: legacyConfig,
    tool: "search_catalog",
    args: { catalog: { query: "wool runner" } },
    fetchImpl: fakeFetch({ jsonrpc: "2.0", id: 1, result: { content: [] } }, capture),
    sleep: noSleep,
  });

  assert.equal(capture.length, 1);
  assert.equal(capture[0].url, "https://example-store.com/api/mcp");
  assert.equal(capture[0].headers["Content-Type"], "application/json");
  const sent = JSON.parse(capture[0].body);
  assert.equal(sent.jsonrpc, "2.0");
  assert.equal(sent.method, "tools/call");
  assert.equal(sent.params.name, "search_catalog");
  assert.deepEqual(sent.params.arguments, { catalog: { query: "wool runner" } });
  // The legacy surface takes no UCP agent metadata.
  assert.equal("meta" in sent.params.arguments, false);
});

test("attaches the UCP agent profile to every call, including read-only ones", async () => {
  const capture: Capture[] = [];
  await callShopifyTool({
    config: ucpConfig,
    tool: "search_catalog",
    args: { catalog: { query: "wool runner" } },
    fetchImpl: fakeFetch({ jsonrpc: "2.0", id: 1, result: { content: [] } }, capture),
    sleep: noSleep,
  });
  const sent = JSON.parse(capture[0].body);
  assert.deepEqual(sent.params.arguments.meta, {
    "ucp-agent": { profile: "https://cardea.example/agent-profile" },
  });
});

test("prefers structuredContent, falling back to parsing the text content mirror", async () => {
  const structured = await callShopifyTool({
    config: ucpConfig,
    tool: "get_cart",
    args: { id: "c1" },
    fetchImpl: fakeFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: { id: "cart-1" }, content: [{ type: "text", text: "{}" }] },
    }),
    sleep: noSleep,
  });
  assert.equal(structured.evidence.excerpt, JSON.stringify({ id: "cart-1" }));

  const mirrored = await callShopifyTool({
    config: legacyConfig,
    tool: "get_cart",
    args: { cart_id: "c1" },
    fetchImpl: fakeFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: '{"id":"cart-2"}' }] },
    }),
    sleep: noSleep,
  });
  assert.equal(mirrored.evidence.excerpt, JSON.stringify({ id: "cart-2" }));
});

test("ignores a trailing plain-text banner beside the JSON content part", async () => {
  // Exactly what the live legacy endpoint returns: the payload, then a separate
  // deprecation banner. Joining the parts would produce invalid JSON and strip
  // every chainable id, so each part is parsed independently.
  const result = await callShopifyTool({
    config: legacyConfig,
    tool: "search_catalog",
    args: {},
    fetchImpl: fakeFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          { type: "text", text: '{"products":[{"id":"gid://shopify/Product/7"}]}' },
          {
            type: "text",
            text: "DEPRECATION NOTICE: This tool is served by the Storefront MCP server at /api/mcp and will no longer be accessible after August 31, 2026.",
          },
        ],
      },
    }),
    sleep: noSleep,
  });

  assert.equal(result.evidence.excerpt, '{"products":[{"id":"gid://shopify/Product/7"}]}');
  assert.deepEqual(result.refs.productIds, ["gid://shopify/Product/7"]);
});

test("falls back to raw text when no content part is JSON at all", async () => {
  const result = await callShopifyTool({
    config: legacyConfig,
    tool: "search_catalog",
    args: {},
    fetchImpl: fakeFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "service temporarily degraded" }] },
    }),
    sleep: noSleep,
  });
  assert.equal(result.evidence.excerpt, "service temporarily degraded");
  assert.deepEqual(result.refs.productIds, []);
});

test("surfaces a JSON-RPC error as a terminal typed failure without retrying", async () => {
  const capture: Capture[] = [];
  await assert.rejects(
    () =>
      callShopifyTool({
        config: ucpConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: fakeFetch(
          {
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32001, message: "UCP discovery failed" },
          },
          capture,
        ),
        sleep: noSleep,
      }),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "invalid_input",
  );
  assert.equal(capture.length, 1, "an application error must not be retried");
});

test("reads Shopify's complexity score when it is sent", async () => {
  const result = await callShopifyTool({
    config: legacyConfig,
    tool: "search_catalog",
    args: {},
    fetchImpl: fakeFetch({ jsonrpc: "2.0", id: 1, result: { content: [] } }, [], {
      headers: { "shopify-complexity-score-v2": "41" },
    }),
    sleep: noSleep,
  });
  assert.equal(result.complexityScore, 41);
});

/* -------------------------------------------------------------------------- */
/* Failure handling                                                           */
/* -------------------------------------------------------------------------- */

test("retries a 5xx up to the bound, then fails typed", async () => {
  const capture: Capture[] = [];
  await assert.rejects(
    () =>
      callShopifyTool({
        config: legacyConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: fakeFetch({}, capture, { status: 503 }),
        maxRetries: 2,
        sleep: noSleep,
      }),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "upstream_error",
  );
  assert.equal(capture.length, 3, "one initial attempt plus two retries");
});

test("does not retry a 4xx, which cannot succeed on replay", async () => {
  const capture: Capture[] = [];
  await assert.rejects(
    () =>
      callShopifyTool({
        config: legacyConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: fakeFetch({}, capture, { status: 422 }),
        maxRetries: 2,
        sleep: noSleep,
      }),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "invalid_input",
  );
  assert.equal(capture.length, 1);
});

test("classifies an aborted request as a timeout", async () => {
  const timingOutFetch: ShopifyFetch = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  await assert.rejects(
    () =>
      callShopifyTool({
        config: legacyConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: timingOutFetch,
        timeoutMs: 5,
        maxRetries: 0,
        sleep: noSleep,
      }),
    (error: unknown) =>
      error instanceof ShopifyMcpError && error.reason === "timeout" && error.retryable,
  );
});

test("a real hung request is aborted by the hard timeout rather than hanging forever", async () => {
  // Honors the injected AbortSignal exactly as a real fetch would.
  const hangingFetch: ShopifyFetch = (_url, request) =>
    new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  await assert.rejects(
    () =>
      callShopifyTool({
        config: legacyConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: hangingFetch,
        timeoutMs: 10,
        maxRetries: 0,
        sleep: noSleep,
      }),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "timeout",
  );
});

test("rejects a non-JSON body as malformed rather than passing it through", async () => {
  await assert.rejects(
    () =>
      callShopifyTool({
        config: legacyConfig,
        tool: "search_catalog",
        args: {},
        fetchImpl: fakeFetch(null, [], { raw: "<html>maintenance</html>" }),
        maxRetries: 0,
        sleep: noSleep,
      }),
    (error: unknown) => error instanceof ShopifyMcpError && error.reason === "malformed_response",
  );
});

/* -------------------------------------------------------------------------- */
/* Evidence bounding and digest                                               */
/* -------------------------------------------------------------------------- */

test("digests the full payload but excerpts only a capped prefix", () => {
  const payload = { blob: "x".repeat(20_000) };
  const serialized = JSON.stringify(payload);
  const evidence = buildShopifyEvidence({
    storeDomain: "example-store.com",
    tool: "search_catalog",
    payload,
    now: new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.equal(evidence.trust, "untrusted");
  assert.equal(evidence.provider, "shopify");
  assert.equal(evidence.origin, "https://example-store.com");
  assert.equal(evidence.bytes, Buffer.byteLength(serialized, "utf8"));
  assert.equal(evidence.truncated, true);
  assert.ok(Buffer.byteLength(evidence.excerpt, "utf8") <= SHOPIFY_EVIDENCE_EXCERPT_BYTE_CAP);
  // The digest covers the whole payload, not the excerpt, so it stays verifiable.
  assert.equal(evidence.digestSha256, createHash("sha256").update(serialized).digest("hex"));
  assert.equal(evidence.capturedAt, "2026-08-26T12:00:00.000Z");
});

test("a small payload is neither truncated nor altered", () => {
  const evidence = buildShopifyEvidence({
    storeDomain: "example-store.com",
    tool: "get_cart",
    payload: { id: "cart-1" },
  });
  assert.equal(evidence.truncated, false);
  assert.equal(evidence.excerpt, '{"id":"cart-1"}');
});

/* -------------------------------------------------------------------------- */
/* Structured references                                                      */
/* -------------------------------------------------------------------------- */

test("extracts chainable ids by GID kind", () => {
  const refs = extractShopifyRefs({
    products: [
      {
        id: "gid://shopify/Product/1",
        variants: [{ id: "gid://shopify/ProductVariant/10" }],
      },
      { id: "gid://shopify/Product/2", variants: [{ id: "gid://shopify/ProductVariant/20" }] },
    ],
  });
  assert.deepEqual(refs.productIds, ["gid://shopify/Product/1", "gid://shopify/Product/2"]);
  assert.deepEqual(refs.variantIds, [
    "gid://shopify/ProductVariant/10",
    "gid://shopify/ProductVariant/20",
  ]);
  assert.equal(refs.cartId, null);
});

test("extracts the cart id, line ids, and the human checkout handoff URL", () => {
  const refs = extractShopifyRefs({
    id: "gid://shopify/Cart/abc?key=1",
    line_items: [{ id: "gid://shopify/CartLine/line-1", item: { id: "gid://shopify/ProductVariant/9" } }],
    continue_url: "https://store.example/cart/c/abc",
  });
  assert.equal(refs.cartId, "gid://shopify/Cart/abc?key=1");
  assert.deepEqual(refs.lineIds, ["gid://shopify/CartLine/line-1"]);
  assert.equal(refs.continueUrl, "https://store.example/cart/c/abc");
});

test("carries no prices, copy, or imagery — only opaque ids and the handoff URL", () => {
  const refs = extractShopifyRefs({
    products: [
      {
        id: "gid://shopify/Product/1",
        title: "Secret Product Name",
        description: { html: "marketing copy" },
        price_range: { min: { amount: 11000 } },
        media: [{ url: "https://cdn.shopify.com/image.png" }],
      },
    ],
  });
  const serialized = JSON.stringify(refs);
  for (const leaked of ["Secret Product Name", "marketing copy", "11000", "cdn.shopify.com"]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} must not appear in refs`);
  }
});

test("deduplicates and caps id lists so a huge response cannot blow up the result", () => {
  const refs = extractShopifyRefs({
    a: Array.from({ length: 400 }, (_, index) => ({ id: `gid://shopify/Product/${index}` })),
    b: Array.from({ length: 50 }, () => ({ id: "gid://shopify/Product/duplicate" })),
  });
  assert.equal(refs.productIds.length, SHOPIFY_MAX_REFS);
  assert.equal(refs.productIds.filter((id) => id.endsWith("duplicate")).length <= 1, true);
});

test("survives deeply nested and cyclic-shaped payloads without hanging", () => {
  let nested: Record<string, unknown> = { id: "gid://shopify/Product/deep" };
  for (let depth = 0; depth < 200; depth += 1) nested = { child: nested };
  assert.doesNotThrow(() => extractShopifyRefs(nested));

  const cyclic: Record<string, unknown> = { id: "gid://shopify/Cart/c1" };
  cyclic.self = cyclic;
  const refs = extractShopifyRefs(cyclic);
  assert.equal(refs.cartId, "gid://shopify/Cart/c1");
});

test("ids remain available even when the evidence excerpt is truncated mid-JSON", async () => {
  // The exact situation that motivated refs: a real catalog response exceeds the
  // excerpt cap, so the excerpt alone cannot be parsed to chain the next call.
  const payload = {
    id: "gid://shopify/Cart/chainable",
    filler: "x".repeat(20_000),
  };
  const result = await callShopifyTool({
    config: legacyConfig,
    tool: "get_cart",
    args: { cart_id: "c1" },
    fetchImpl: fakeFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: payload },
    }),
    sleep: noSleep,
  });

  assert.equal(result.evidence.truncated, true);
  assert.throws(() => JSON.parse(result.evidence.excerpt), "excerpt is genuinely unparseable");
  assert.equal(result.refs.cartId, "gid://shopify/Cart/chainable");
});

test("caps multi-byte text on a character boundary, never mid-codepoint", () => {
  const evidence = buildShopifyEvidence({
    storeDomain: "example-store.com",
    tool: "search_catalog",
    // 4-byte emoji: a naive byte slice would leave a replacement character.
    payload: "🛍️".repeat(4_000),
  });
  assert.equal(evidence.excerpt.includes("�"), false);
  assert.ok(Buffer.byteLength(evidence.excerpt, "utf8") <= SHOPIFY_EVIDENCE_EXCERPT_BYTE_CAP);
});
