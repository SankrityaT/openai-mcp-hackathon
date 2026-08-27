/**
 * Cardea's UCP platform ("agent") profile.
 *
 * WHY THIS EXISTS. Shopify's supported storefront surface (`/api/ucp/mcp`)
 * refuses every tool call — including read-only catalog search — unless the
 * request carries `meta["ucp-agent"].profile` pointing at a document Shopify
 * can fetch server-side. Without one, the live endpoint answers:
 *
 *     {"code":"profile_unreachable",
 *      "content":"Unable to fetch agent profile: Network error"}
 *
 * This route serves that document. It is public and completely static: no
 * session, no database, no secret, and nothing user-specific. It must be
 * publicly reachable to work at all, which is the point.
 *
 * WHY THE CAPABILITY LIST IS SHORT — this is the security-relevant part.
 *
 * UCP negotiation is a server-selects *intersection*: per the specification,
 * "Businesses MUST compute the intersection of platform and business
 * capabilities", and a business capability is active only "if a platform
 * capability with the same name exists". So the capabilities Cardea declares
 * here are a hard ceiling on what the storefront will activate for Cardea.
 *
 * By declaring only cart and catalog — and deliberately NOT
 * `dev.ucp.shopping.checkout`, `.order`, `.fulfillment`, or `.discount` —
 * checkout is excluded by the protocol itself, on Shopify's side, before any
 * Cardea code runs. That is a far stronger guarantee than a client-side
 * allowlist, and it composes with one: `shopify-mcp-client.ts` also refuses
 * those tool names outright.
 *
 * Observed contrast, to make the stakes concrete: calling `create_cart` with
 * Shopify's own published example profile (which *does* declare checkout) makes
 * the storefront return an active `dev.ucp.shopping.checkout` capability plus
 * full `payment_handlers` configuration — Google Pay merchant ids, accepted
 * card brands, Shop Pay shop id. With the profile below, none of that is
 * negotiated at all.
 */

const UCP_VERSION = "2026-04-08";

const AGENT_PROFILE = {
  ucp: {
    version: UCP_VERSION,
    services: {
      "dev.ucp.shopping": [
        {
          version: UCP_VERSION,
          spec: "https://ucp.dev/2026-04-08/specification/overview",
          transport: "mcp",
          schema: "https://ucp.dev/2026-04-08/services/shopping/mcp.openrpc.json",
        },
      ],
    },
    capabilities: {
      // Read the catalog.
      "dev.ucp.shopping.catalog.search": [
        {
          version: UCP_VERSION,
          spec: "https://ucp.dev/2026-04-08/specification/catalog",
          schema: "https://ucp.dev/2026-04-08/schemas/shopping/catalog_search.json",
        },
      ],
      "dev.ucp.shopping.catalog.lookup": [
        {
          version: UCP_VERSION,
          spec: "https://ucp.dev/2026-04-08/specification/catalog",
          schema: "https://ucp.dev/2026-04-08/schemas/shopping/catalog_lookup.json",
        },
      ],
      // Prepare a reversible cart. Nothing beyond this point is declared:
      // no checkout, no order, no fulfillment, no discount, no payment handler.
      "dev.ucp.shopping.cart": [
        {
          version: UCP_VERSION,
          spec: "https://ucp.dev/2026-04-08/specification/cart",
          schema: "https://ucp.dev/2026-04-08/schemas/shopping/cart.json",
        },
      ],
    },
  },
} as const;

export async function GET() {
  return Response.json(AGENT_PROFILE, {
    headers: {
      // Public, static, and identical for every caller, so it is safe and
      // useful to let Shopify cache it. The UCP spec tells platforms to honor
      // cache-control on profile fetches.
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json",
    },
  });
}
