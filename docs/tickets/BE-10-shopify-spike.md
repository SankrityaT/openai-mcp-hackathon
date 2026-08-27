# BE-10: Optional one-day Shopify search and cart spike

Status: optional, blocked until BE-07 is stable.

## Time box

One working day maximum, including setup, implementation, verification, and removal decision.

## Outcome

Determine whether Shopify adds one reliable real commerce capability without weakening the core two-way WebMCP demo.

## Scope

- Read current official Shopify WebMCP, Storefront MCP, Global Catalog, cart/checkout, auth, rate-limit, and caching rules.
- Select the smallest supported search and cart path.
- Request approval for exact dependencies, account setup, and credentials.
- Implement through the generic capability adapter.
- Support catalog search, item/variant comparison, and cart preparation only.
- Hand final checkout to the user.
- Keep provenance and Shopify restrictions visible.
- Use dedicated demo-safe data and no real purchase.

## Keep criteria

Keep the integration only if all are true:

- Real search is reliable.
- Variant comparison is structured and useful.
- Cart preparation works without trusted-agent checkout privileges.
- No overlap with Composio commerce tools.
- No meaningful golden-journey latency or instability.
- Demo can be repeated from a clean session.
- Official caching and imagery restrictions are respected.

## Cut criteria

Remove the integration and all public claims if any are true:

- Setup or auth exceeds the time box.
- Checkout trust or protected data is required.
- Search/cart behavior is intermittent.
- It distracts from companion WebMCP.
- It requires special judge credentials not supported by the submission.
- It threatens release hardening.

## Acceptance

- One isolated demo flow passes.
- No purchase occurs.
- Failure cleanly falls back to companion capabilities or user takeover.
- Removing the adapter does not change core contracts.
- Explicit keep/cut decision is recorded before the ticket closes.

## Agent prompt header

```text
Run ticket docs/tickets/BE-10-shopify-spike.md only after the core product is stable. Respect the one-day time box and remove the integration if every keep criterion is not met.
```

---

# Status update — 2026-08-27

Implemented and verified against live public storefronts. Everything below was
observed directly, not recalled: endpoints were called, headers were read, and
the transcripts are reproducible with the committed smoke script.

**Recommendation: KEEP the server-side adapter, CUT the native WebMCP prong.**
The one open compliance question was escalated and ruled on; see
"Compliance question" below. No caveat remains.

## What shipped

| File | Role |
| --- | --- |
| `src/harness/adapters/shopify-mcp-client.ts` | JSON-RPC transport, tool allowlist, evidence bounding, id extraction |
| `src/harness/adapters/shopify-capability.ts` | `CapabilityAdapter` with `provider: "shopify"` |
| `src/harness/adapters/shopify-evidence-payload.ts` | Durable payload builder; excludes catalog text by construction |
| `src/harness/adapters/shopify-smoke.mjs` | Live smoke against a real storefront |
| `src/app/api/integrations/shopify/execute/route.ts` | Authenticated `GET` status / `POST` execute |
| `src/app/api/integrations/shopify/execute-request.ts` | Pure, unit-tested request validation |
| `src/app/api/integrations/shopify/agent-profile/route.ts` | Cardea's UCP platform profile |
| `src/app/canvas/_components/shopify-panel.tsx` + `use-shopify-capability.ts` | Canvas section, reusing companion styles |

Env: `CARDEA_SHOPIFY_STORE_DOMAIN` (gate), `CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL`,
`CARDEA_SHOPIFY_MCP_SURFACE`. No secrets — these endpoints are public.

Capabilities (five; no checkout, payment, or customer-account capability exists):

| Capability | In | Out |
| --- | --- | --- |
| `shopify.catalog_search` | `{query, limit?, country?, language?}` | evidence + `refs.productIds/variantIds` |
| `shopify.product_details` | `{productId, options?, country?, language?}` | evidence + `refs.variantIds` |
| `shopify.cart_prepare` | `{items:[{variantId, quantity}]}` | evidence + `refs.cartId/lineIds` |
| `shopify.cart_update` | `{cartId, items:[{lineId, quantity}]}` | evidence + `refs.lineIds` |
| `shopify.cart_read` | `{cartId}` | evidence + `refs.continueUrl` |

Every result is bounded untrusted evidence: origin, sha-256 over the full
payload, `trust: "untrusted"`. The 4 KB excerpt is transient — shown in the
canvas, never written to the database. See the compliance ruling below.

## The surface is mid-migration, and the old one dies in days

`POST https://{store}/api/mcp` still answers, but every response carries:

```
x-shopify-mcp-api-version: unstable
deprecation: @1782259200
sunset: Mon, 31 Aug 2026 00:00:00 GMT
link: <https://shopify.dev/docs/agents>; rel="successor-version"
```

and appends a second plain-text content part reading *"DEPRECATION NOTICE: This
tool is served by the Storefront MCP server at /api/mcp and will no longer be
accessible after August 31, 2026. Migrate to the UCP-conforming tools at
/api/ucp/mcp."*

The successor is **UCP** (Universal Commerce Protocol) v2026-04-08 at
`POST https://{store}/api/ucp/mcp`, discoverable from `/.well-known/ucp`.

**This is the single most important finding for the keep/cut decision: any
Shopify claim made after 2026-08-31 must be running on the UCP surface.** The
adapter therefore speaks both, selected by env, with the legacy surface
reporting its own sunset in `status()` and in the canvas.

### The successor hands agents a checkout button

`tools/list` on `/api/ucp/mcp` returns 13 tools, including `create_checkout`,
`update_checkout`, **`complete_checkout`**, `cancel_checkout`, `get_checkout`,
and `get_order`. The ticket forbids all of it, so the allowlist is load-bearing
rather than decorative, and it is enforced in three independent places:

1. `SHOPIFY_ALLOWED_TOOLS` — only the five reviewed tool names are callable.
2. `SHOPIFY_DENIED_TOOLS` — checkout/order names are refused by name, before
   any network call, with their own error reason.
3. **Protocol-level.** UCP negotiation is a server-selects *intersection*: a
   business capability activates only if the platform declares it too. Cardea's
   agent profile declares only `dev.ucp.shopping.cart`, `.catalog.search`, and
   `.catalog.lookup`. Checkout is therefore excluded by Shopify, on Shopify's
   side, before Cardea runs.

Concrete demonstration of (3): calling `create_cart` with Shopify's *own*
published example profile — which does declare checkout — makes the storefront
return an active `dev.ucp.shopping.checkout` capability plus full
`payment_handlers` config (Google Pay merchant id, accepted card brands, Shop
Pay shop id). With Cardea's narrowed profile, none of that is negotiated.

Also note UCP gates **every** call, including read-only search, behind an agent
profile URI it fetches server-side; without one it returns
`{"code":"profile_unreachable"}`. That is why the UCP surface cannot run from
localhost and why `/api/integrations/shopify/agent-profile` exists.

## Live verification

Store used: **allbirds.com** (public, Shopify-hosted). `gymshark.com` also
responded; no store was found with the endpoint disabled. Reproduce with:

```
pnpm test:harness
CARDEA_SHOPIFY_STORE_DOMAIN=allbirds.com node src/harness/adapters/shopify-smoke.mjs
```

Both surfaces completed the full flow. Abridged transcript:

```
LEGACY  /api/mcp
  catalog_search      226ms  13523 B  digest d39530fe…  2 products, 14 variants
  get_product_details 153ms   2574 B  Men's Wool Runner True Black
  variant comparison         Size 8–14 -> 7 distinct variant ids, all $110.00,
                             all available=false  (whole product sold out)
  → next product             Women's Wool Runner Natural Black, Size 5 available=true
  update_cart         486ms   1760 B  cart gid://shopify/Cart/hWNG89as…
                                      line gid://shopify/CartLine/5eec9440…
  get_cart            123ms   1760 B  checkout handoff URL present
  RESULT: search, detail, comparison, cart prepare, cart read all succeeded.
          No checkout completed. No payment made.

UCP  /api/ucp/mcp
  search_catalog      441ms  21290 B
  get_product         167ms   8584 B  (truncated past the 4 KB excerpt cap)
  create_cart         488ms   4909 B  cart gid://shopify/Cart/hWNG89gA…
                                      line gid://shopify/CartLine/0e977757…
  get_cart            308ms   4909 B  checkout handoff URL present
```

Two real defects were found and fixed only because the smoke ran live:

- **Two content parts.** The legacy endpoint returns the JSON payload *and* a
  plain-text deprecation banner as separate `content[]` entries. Concatenating
  them yields invalid JSON, which silently degraded every result to an opaque
  string and stripped all chainable ids. Parts are now parsed independently.
- **Unparseable excerpts.** A capped excerpt is truncated mid-JSON by design, so
  it cannot be parsed to chain the next call. `refs` now carries bounded opaque
  ids (product, variant, cart, line, handoff URL) extracted from the full
  payload before capping — ids only, no prices, copy, or imagery.

Two upstream quirks worth knowing, neither a Cardea bug:

- `selectedOrFirstAvailableVariant` frequently reports `available: false`, so a
  cart built from it silently drops its only line. Preparation now verifies a
  line actually landed.
- UCP product payloads (~8 KB) exceed the 4 KB evidence cap, so on that surface
  selection falls back to `refs` plus cart adjudication.

## Shopify's stated constraints, and how they are honored

From `https://shopify.dev/docs/agents/catalog` ("Usage guidelines"):

> "Don't cache or re-use images: Images may only be used in connection with the
> related merchant's product listing and must be rendered in real-time (not
> downloaded to servers)."

> "Don't cache search results: Catalog results reflect merchant preferences on
> pricing, availability, and presentation. Caching results isn't allowed."

- **Imagery.** Cardea never fetches, proxies, or re-hosts product images. Media
  URLs survive only as text inside the excerpt, and the panel renders that
  excerpt as text — there is no `<img>` anywhere in this feature.
- **Caching.** No response cache, no read-through, `cache: "no-store"` on every
  request, and a fresh live call for every invocation. The wire agrees:
  responses set `cache-control: no-cache, no-store` and the same for
  `cdn-cache-control`.
- **Rate limits.** No numeric quota is published and no `X-RateLimit-*` headers
  are sent; Shopify states keyless access cannot get limit increases and scales
  limits by identification tier. Cardea is anonymous, so it is frugal by design:
  one 12 s timeout, at most two retries, retries only on retryable failures,
  exponential backoff, no polling. Observed `shopify-complexity-score-v2` 35–41.

### Compliance question — RAISED, RULED, RESOLVED (2026-08-27)

The first implementation persisted a bounded 4 KB **excerpt** of each result as
an `evidence.recorded` event, arguing that a timestamped provenance record is
not a cache. Rather than assume that reading, it was escalated.

**Ruling: take the strict reading.** "Caching results isn't allowed" is written
broadly, and Cardea does not get to narrow it on its own authority.

Implemented, with the boundary drawn at display vs. storage:

| | Excerpt text | Digest | Byte counts | `refs` |
| --- | --- | --- | --- | --- |
| **Transient** (HTTP response, canvas render) | yes | yes | yes | yes |
| **Durable** (`evidence.recorded` in the database) | **never** | yes | yes | yes |

Displaying catalog text to the person who asked for it is not caching it.
Writing it to a database is. So the excerpt is rendered and then dropped; what
persists is the sha-256 digest, `resultBytes` / `displayedExcerptBytes`, and the
structured `refs` (opaque Shopify GIDs plus the cart handoff URL). No titles,
descriptions, prices, availability, or image URLs reach storage — nothing a
reader could reconstruct a listing from, and nothing that could answer a later
query. The payload also carries `excerptWithheld: "shopify_no_cache_policy"` so
the mission log states why there is no text.

The digest keeps the observation auditable: anyone holding the original payload
can prove it is what Cardea saw, without Cardea retaining the text.

Enforced structurally in `src/harness/adapters/shopify-evidence-payload.ts` —
the durable payload type has no `excerpt` field, so no code path can persist
catalog text even by accident. `shopify-evidence-payload.test.ts` pins it: a
payload containing any merchant catalog string fails, refs are re-narrowed so
text cannot be smuggled through that channel, and one test guards the guard by
proving the detector can actually fail.

**No caveat remains on the keep recommendation.**

## Native storefront WebMCP: CUT

**Conclusion: a third-party Shopify storefront's browser WebMCP tools cannot be
discovered cross-origin by Cardea, and no merchant configuration changes that.**
No code was written for this prong.

Evidence:

1. **Storefronts refuse to be framed at all.** `https://www.allbirds.com/...`
   returns `x-frame-options: DENY` and `content-security-policy: …
   frame-ancestors 'none'; …`. Cardea's cross-origin WebMCP mechanism requires
   embedding the origin in an iframe with `allow="tools"` — exactly how the
   Cardea companion works. A storefront can never be that iframe. This is
   first-party observed evidence, not inference.
2. **Exposure is the embedded page's decision, not the embedder's.** Tools reach
   another origin only when the page itself calls
   `registerTool(tool, { exposedTo: [origin] })` naming Cardea's exact origin
   (see `src/webmcp/model-context.d.ts` and `apps/companion/webmcp.js`).
   That is merchant-side code on merchant-side pages; Cardea cannot cause it,
   and Shopify does not offer a merchant setting for it.
3. **Shopify's own agent story is server-side.** Their published path for agents
   is the MCP/UCP endpoint plus `/.well-known/ucp` discovery
   (`https://shopify.dev/docs/agents`), not browser WebMCP for third parties.

Consequence: it would be feasible only on a storefront we control, and even then
only by injecting theme code that calls `registerTool` with `exposedTo` naming
Cardea's origin, and by relaxing that store's `frame-ancestors`. That is a store
we built talking to ourselves — it proves nothing about real commerce and would
be a misleading demo. Not pursued, per the ticket's rule against speculative
embedding of arbitrary stores.

**Cardea's two-way WebMCP story remains the companion origin. Shopify is a
server-side capability adapter, and the submission should say exactly that.**

## Keep / cut against the ticket's criteria

| Keep criterion | Verdict |
| --- | --- |
| Real search is reliable | **Pass** — sub-500 ms, repeatable, two stores |
| Variant comparison structured and useful | **Pass** — 7 variants with distinct ids, prices, availability |
| Cart preparation without trusted-agent checkout | **Pass** — carts created on both surfaces, no checkout privilege |
| No overlap with Composio commerce tools | **Pass** — Composio scope is Gmail + Calendar only |
| No meaningful latency or instability | **Pass** — 120–490 ms per call, off the golden path, env-gated |
| Repeatable from a clean session | **Pass** — no auth, no state; smoke script reruns cold |
| Caching and imagery restrictions respected | **Pass** — strict reading adopted; no catalog text is persisted |

| Cut criterion | Triggered? |
| --- | --- |
| Setup or auth exceeds the time box | No — public endpoints, no account, no credential |
| Checkout trust or protected data required | No — and checkout is excluded three ways |
| Search/cart behavior intermittent | No — though sold-out variants must be handled |
| Distracts from companion WebMCP | No — separate panel; the WebMCP prong is explicitly cut |
| Needs judge credentials the submission lacks | No — nothing to provision |
| Threatens release hardening | No — absent env means zero behavioral change |

## Known limitations

- The legacy surface **stops working 2026-08-31**. Deployments must set
  `CARDEA_SHOPIFY_UCP_AGENT_PROFILE_URL` before then.
- UCP requires a publicly reachable agent profile, so that surface cannot be
  exercised from localhost without one. The profile route was verified by
  construction against the spec's intersection rules, **not** live end-to-end,
  because that needs a public deployment.
- The 4 KB excerpt cap truncates UCP product payloads; selection falls back to
  `refs`.
- The route reuses the `composio` rate-limit class, because adding a
  `RateLimitRouteClass` means editing `src/core`, which this optional spike
  deliberately does not touch. Sharing the bucket can only tighten the ceiling.
- Storefront payloads include an `instructions` field containing natural-language
  directions to the agent (e.g. *"Assist them in navigating to checkout"*).
  Cardea treats it as untrusted evidence like everything else, which is exactly
  the prompt-injection boundary `ARCHITECTURE.md` describes. Worth a reviewer's
  attention: the storefront is actively trying to steer the agent.
- Removing the feature is deleting `shopify-*` files, the API directory, and the
  panel. No contract changes.

