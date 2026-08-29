/**
 * Live smoke test for the Shopify storefront capability adapter.
 *
 * Exercises the REAL shipped client against a REAL public storefront — no
 * fakes, no fixtures — so the spike's claims are backed by an actual transcript.
 * It performs catalog search, product detail, cart preparation, and cart read.
 * It never completes a checkout and never spends money: a Shopify cart is an
 * unreserved, unpriced, abandonable object.
 *
 * Usage (the compile step produces the JS this script imports):
 *
 *     pnpm test:harness
 *     CARDEA_SHOPIFY_STORE_DOMAIN=allbirds.com node src/harness/adapters/shopify-smoke.mjs
 *
 * or with an env file:
 *
 *     node --env-file=.env.local src/harness/adapters/shopify-smoke.mjs
 *
 * With no CARDEA_SHOPIFY_STORE_DOMAIN set it prints the not-configured state
 * and exits 0, mirroring how the adapter itself degrades.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BUILD = "../../../.context/harness-tests/harness/adapters";

let capability;
let client;
try {
  capability = require(`${BUILD}/shopify-capability.js`);
  client = require(`${BUILD}/shopify-mcp-client.js`);
} catch {
  console.error("Compiled adapter not found. Run `pnpm test:harness` first.");
  process.exit(1);
}

const truncate = (value, max = 700) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text;
};

function heading(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function run() {
  const adapter = new capability.ShopifyCapabilityAdapter();
  const status = adapter.status();

  heading("CONFIGURATION");
  console.log(JSON.stringify(status, null, 2));
  if (!status.configured) {
    console.log("\nNot configured — the adapter is invisible and calls nothing. Exiting cleanly.");
    return;
  }

  const resolution = client.resolveShopifyConfig();
  console.log(`endpoint: ${resolution.config.endpoint}`);

  const discovered = await adapter.discover();
  heading("DISCOVERY");
  for (const item of discovered) {
    console.log(`  ${item.id.padEnd(26)} ${item.readOnly ? "read " : "write"}  ${item.risk.level}`);
  }
  // Check for the actual denied TOOL NAMES, not the bare word "checkout":
  // `cart_read`'s description legitimately mentions handing a checkout URL to
  // the person, and a substring match on that would be a false alarm.
  const surface = JSON.stringify(discovered);
  const leaked = client.SHOPIFY_DENIED_TOOLS.filter((tool) => surface.includes(tool));
  console.log(`\n  denied tools reachable via discovery: ${leaked.length ? leaked.join(", ") : "none"}`);
  console.log(`  capability ids: ${discovered.map((item) => item.id).join(", ")}`);

  let sequence = 0;
  const execute = async (capabilityId, input, options = {}) => {
    sequence += 1;
    const started = Date.now();
    const result = await adapter.execute({
      capabilityId,
      missionId: "smoke",
      input,
      correlationId: `smoke-${sequence}`,
      idempotencyKey: `smoke-${sequence}`,
    });
    // The variant sweep would otherwise print ten near-identical excerpts.
    if (options.quiet) return result.output;
    console.log(`\n--- ${capabilityId} (${Date.now() - started}ms) ---`);
    console.log(`input      : ${JSON.stringify(input)}`);
    console.log(`tool       : ${result.output.tool}`);
    console.log(`provenance : ${result.provenance}`);
    console.log(`trust      : ${result.trust}`);
    console.log(`digest     : ${result.output.digestSha256}`);
    console.log(`bytes      : ${result.output.bytes} (truncated: ${result.output.truncated})`);
    console.log(`excerpt    : ${truncate(result.output.excerpt)}`);
    console.log(`refs       : ${JSON.stringify(result.output.refs)}`);
    return result.output;
  };

  // 1. Catalog search. The excerpt is capped and therefore not parseable JSON;
  // chaining runs off `refs`, which is extracted from the full payload.
  heading("1. CATALOG SEARCH");
  const search = await execute("shopify.catalog_search", { query: process.env.SMOKE_QUERY ?? "wool runner", limit: 2 });
  const candidates = search.refs.productIds.slice(0, 3);
  if (candidates.length === 0) throw new Error("search returned no product ids");

  // 2 + 3. Product detail and variant comparison.
  //
  // A single product fits inside the excerpt cap, so the excerpt here is real
  // parseable JSON and can drive selection. Whole products are frequently sold
  // out — and `selectedOrFirstAvailableVariant` still reports available:false
  // in that case — so each option value is compared until something is
  // genuinely purchasable. That comparison is the ticket's requirement, and it
  // is also the only way to make the cart step meaningful rather than a cart
  // that silently drops its only line.
  //
  // On the UCP surface a single product payload is ~8 KB and so exceeds the
  // 4 KB evidence cap. Rather than inflate what Cardea persists, selection then
  // falls back to the ids in `refs` and lets the cart itself adjudicate: a
  // sold-out line is silently dropped, so a cart that comes back with no line
  // ids means "try the next variant". That is exactly the reasoning a real
  // agent must do when its evidence is bounded.
  let variantId = null;
  let productId = null;
  const fallbackVariantIds = [];

  for (const candidate of candidates) {
    heading(`2. PRODUCT DETAIL · ${candidate}`);
    const detail = await execute("shopify.product_details", { productId: candidate });
    if (detail.truncated) {
      console.log(
        `\nProduct payload truncated (${detail.bytes} B > excerpt cap); ` +
          "falling back to id-based selection via the cart.",
      );
      fallbackVariantIds.push(...detail.refs.variantIds.map((id) => [candidate, id]));
      continue;
    }
    const product = JSON.parse(detail.excerpt).product;
    const optionName = product?.options?.[0]?.name;
    const optionValues = product?.options?.[0]?.values ?? [];
    console.log(`\nproduct  : ${product?.title}`);
    console.log(`option   : ${optionName} = ${JSON.stringify(optionValues)}`);
    console.log(
      `default  : ${product?.selectedOrFirstAvailableVariant?.title} ` +
        `(available: ${product?.selectedOrFirstAvailableVariant?.available})`,
    );

    heading(`3. VARIANT COMPARISON · ${product?.title}`);
    for (const value of optionValues.slice(0, 10)) {
      const compared = await execute(
        "shopify.product_details",
        { productId: candidate, options: { [optionName]: value } },
        { quiet: true },
      );
      const variant = JSON.parse(compared.excerpt).product?.selectedOrFirstAvailableVariant;
      console.log(
        `  ${optionName} ${String(value).padEnd(4)} -> ${variant?.variant_id}  ` +
          `${variant?.price} ${variant?.currency}  available=${variant?.available}`,
      );
      if (variant?.available) {
        variantId = variant.variant_id;
        productId = candidate;
        break;
      }
    }
    if (variantId) break;
    console.log("\n  every variant of this product is sold out; trying the next product.");
  }

  console.log(`\nchosen product : ${productId ?? "none (will probe by id)"}`);
  console.log(`chosen variant : ${variantId ?? "none (will probe by id)"}`);

  // Whichever route selection took, produce an ordered list of variants to try.
  const attempts = variantId ? [[productId, variantId]] : fallbackVariantIds.slice(0, 8);
  if (attempts.length === 0) {
    console.log("\nNo variant to try; stopping rather than faking one.");
    return;
  }

  // 4. Cart preparation. Reversible: nothing is reserved, charged, or bought.
  // A cart returned with zero line ids means the variant was sold out and
  // silently dropped, which is a failed preparation, not a success.
  heading("4. CART PREPARATION");
  let cart = null;
  for (const [candidateProduct, candidateVariant] of attempts) {
    const prepared = await execute(
      "shopify.cart_prepare",
      { items: [{ variantId: candidateVariant, quantity: 1 }] },
      { quiet: attempts.length > 1 },
    );
    const landed = prepared.refs.lineIds.length > 0;
    if (attempts.length > 1) {
      console.log(`  ${candidateVariant} -> ${landed ? "line added" : "dropped (sold out)"}`);
    }
    if (landed) {
      cart = prepared;
      productId = candidateProduct;
      variantId = candidateVariant;
      break;
    }
  }

  if (!cart) {
    console.log("\nEvery candidate variant was sold out; no cart was prepared. Reporting honestly.");
    return;
  }

  const cartId = cart.refs.cartId;
  console.log(`\nchosen variant : ${variantId}`);
  console.log(`cart id     : ${cartId}`);
  console.log(`line ids    : ${JSON.stringify(cart.refs.lineIds)}`);
  if (!cartId) throw new Error("cart preparation returned no cart id");

  // 5. Cart read — the checkout URL here is handed to the person, never followed.
  heading("5. CART READ");
  const read = await execute("shopify.cart_read", { cartId });
  console.log(`\ncheckout handoff URL present: ${Boolean(read.refs.continueUrl)}`);
  console.log("(handed to the person; Cardea never follows it)");

  heading("RESULT");
  console.log("Search, product detail, cart preparation, and cart read all succeeded.");
  console.log("No checkout was completed and no payment was made.");
}

run().catch((error) => {
  console.error(`\nSMOKE FAILED: ${error?.message ?? error}`);
  process.exit(1);
});
