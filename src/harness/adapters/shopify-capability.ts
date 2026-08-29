/**
 * Shopify storefront capability adapter.
 *
 * "shopify" is a provider string on the generic {@link CapabilityAdapter}
 * contract and nothing more. No core or harness code branches on it; deleting
 * this file and its route removes the feature without touching a contract.
 *
 * The whole adapter is env-gated on `CARDEA_SHOPIFY_STORE_DOMAIN`. With that
 * variable absent — the default everywhere — {@link ShopifyCapabilityAdapter.discover}
 * returns `[]`, the canvas section renders a truthful not-configured state, and
 * no Shopify code ever executes.
 *
 * SCOPE. Catalog search, product/variant detail, and reversible cart
 * preparation only. There is deliberately no checkout, payment, or customer
 * account capability here, and `shopify-mcp-client.ts` refuses the underlying
 * tools even if one were named directly. Final checkout is handed to the human
 * via the storefront's own URL, which is exactly where payment belongs.
 *
 * TRUST. The capability *descriptor* is "derived" (Cardea authors these
 * bounded shapes and controls which tools exist). Everything a storefront
 * *returns* is "untrusted": merchant-authored catalog copy is third-party text
 * from the open internet, and it enters the mission log as evidence with a
 * digest, never as instruction.
 */
import { CapabilityProviderError } from "../capability-errors";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";
import { sanitizeEvidenceExcerptText } from "./composio-support";
import {
  callShopifyTool,
  resolveShopifyConfig,
  ShopifyMcpError,
  type ShopifyCallResult,
  type ShopifyConfig,
  type ShopifyFetch,
  type ShopifySurface,
} from "./shopify-mcp-client";

/* -------------------------------------------------------------------------- */
/* Capability identifiers                                                     */
/* -------------------------------------------------------------------------- */

export const SHOPIFY_CAPABILITY_IDS = {
  catalogSearch: "shopify.catalog_search",
  productDetails: "shopify.product_details",
  cartPrepare: "shopify.cart_prepare",
  cartUpdate: "shopify.cart_update",
  cartRead: "shopify.cart_read",
} as const;

export type ShopifyCapabilityId =
  (typeof SHOPIFY_CAPABILITY_IDS)[keyof typeof SHOPIFY_CAPABILITY_IDS];

export const SHOPIFY_CAPABILITY_ID_LIST: readonly ShopifyCapabilityId[] =
  Object.values(SHOPIFY_CAPABILITY_IDS);

export function isShopifyCapabilityId(value: unknown): value is ShopifyCapabilityId {
  return typeof value === "string" && SHOPIFY_CAPABILITY_ID_LIST.includes(value as ShopifyCapabilityId);
}

/* -------------------------------------------------------------------------- */
/* Bounded input parsing                                                      */
/* -------------------------------------------------------------------------- */

export class ShopifyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyInputError";
  }
}

const MAX_QUERY_CHARS = 200;
const MAX_ID_CHARS = 300;
const MAX_LINE_ITEMS = 10;
const MAX_QUANTITY = 25;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ShopifyInputError(`"${key}" must be a string.`);
  if (value.length > max) throw new ShopifyInputError(`"${key}" exceeds ${max} characters.`);
  return value;
}

function readRequiredString(source: Record<string, unknown>, key: string, max: number): string {
  const value = readString(source, key, max);
  if (value === undefined) throw new ShopifyInputError(`"${key}" is required.`);
  return value;
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ShopifyInputError(`"${key}" must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

/** A locale hint pair. Shopify uses these for regional pricing and translation. */
type LocaleHints = { country?: string; language?: string };

function readLocale(source: Record<string, unknown>): LocaleHints {
  return {
    country: readString(source, "country", 8)?.toUpperCase(),
    language: readString(source, "language", 8)?.toUpperCase(),
  };
}

type CartLine = { variantId?: string; lineId?: string; quantity: number };

function readLines(source: Record<string, unknown>, key: string, minQuantity: number): CartLine[] {
  const raw = source[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ShopifyInputError(`"${key}" must be an array.`);
  if (raw.length > MAX_LINE_ITEMS) {
    throw new ShopifyInputError(`"${key}" may contain at most ${MAX_LINE_ITEMS} entries.`);
  }
  return raw.map((entry) => {
    const record = asRecord(entry);
    const quantity = readInteger(record, "quantity", minQuantity, MAX_QUANTITY);
    if (quantity === undefined) throw new ShopifyInputError(`Each ${key} entry needs a "quantity".`);
    return {
      variantId: readString(record, "variantId", MAX_ID_CHARS),
      lineId: readString(record, "lineId", MAX_ID_CHARS),
      quantity,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Capability -> tool mapping, per surface                                    */
/* -------------------------------------------------------------------------- */

type ToolCall = { tool: string; args: Record<string, unknown> };

/**
 * Builds the surface-specific JSON-RPC arguments for one Cardea capability.
 *
 * Cardea's own input shape is deliberately surface-independent: callers say
 * `{ query }` or `{ items: [{ variantId, quantity }] }` and never learn whether
 * the store is answering on the legacy or the UCP endpoint. That indirection is
 * what lets the deprecated surface be dropped without a contract change.
 *
 * Note the asymmetry on cart creation: legacy has no `create_cart` — omitting
 * `cart_id` from `update_cart` creates one — whereas UCP splits them.
 */
function buildToolCall(
  capabilityId: ShopifyCapabilityId,
  surface: ShopifySurface,
  input: Record<string, unknown>,
): ToolCall {
  const locale = readLocale(input);

  switch (capabilityId) {
    case SHOPIFY_CAPABILITY_IDS.catalogSearch: {
      const query = readRequiredString(input, "query", MAX_QUERY_CHARS);
      const limit = readInteger(input, "limit", 1, 10) ?? 5;
      const context: Record<string, unknown> = {};
      if (locale.country) context.address_country = locale.country;
      if (locale.language) context.language = locale.language;
      const catalog: Record<string, unknown> = { query, pagination: { limit } };
      if (Object.keys(context).length > 0) catalog.context = context;
      // Identical shape on both surfaces; only the endpoint differs.
      return { tool: "search_catalog", args: { catalog } };
    }

    case SHOPIFY_CAPABILITY_IDS.productDetails: {
      const productId = readRequiredString(input, "productId", MAX_ID_CHARS);
      const options = asRecord(input.options);
      if (surface === "legacy") {
        const args: Record<string, unknown> = { product_id: productId };
        if (Object.keys(options).length > 0) args.options = options;
        if (locale.country) args.country = locale.country;
        if (locale.language) args.language = locale.language;
        return { tool: "get_product_details", args };
      }
      // UCP expresses variant selection as an array of {name,label} pairs.
      const selected = Object.entries(options)
        .slice(0, 8)
        .map(([name, label]) => ({ name, label: String(label) }));
      const catalog: Record<string, unknown> = { id: productId };
      if (selected.length > 0) catalog.selected = selected;
      const context: Record<string, unknown> = {};
      if (locale.country) context.address_country = locale.country;
      if (locale.language) context.language = locale.language;
      if (Object.keys(context).length > 0) catalog.context = context;
      return { tool: "get_product", args: { catalog } };
    }

    case SHOPIFY_CAPABILITY_IDS.cartPrepare: {
      const items = readLines(input, "items", 1);
      if (items.length === 0) throw new ShopifyInputError('"items" must contain at least one entry.');
      for (const item of items) {
        if (!item.variantId) throw new ShopifyInputError('Each item needs a "variantId".');
      }
      if (surface === "legacy") {
        return {
          tool: "update_cart",
          args: {
            // No cart_id: the legacy surface creates a fresh cart in that case.
            add_items: items.map((item) => ({
              product_variant_id: item.variantId,
              quantity: item.quantity,
            })),
          },
        };
      }
      return {
        tool: "create_cart",
        args: {
          cart: {
            line_items: items.map((item) => ({
              quantity: item.quantity,
              item: { id: item.variantId },
            })),
          },
        },
      };
    }

    case SHOPIFY_CAPABILITY_IDS.cartUpdate: {
      const cartId = readRequiredString(input, "cartId", MAX_ID_CHARS);
      // Quantity 0 is the documented removal signal, so the floor is 0 here.
      const items = readLines(input, "items", 0);
      if (items.length === 0) throw new ShopifyInputError('"items" must contain at least one entry.');
      if (surface === "legacy") {
        const updates = items.filter((item) => item.lineId);
        const adds = items.filter((item) => !item.lineId && item.variantId);
        const args: Record<string, unknown> = { cart_id: cartId };
        if (updates.length > 0) {
          args.update_items = updates.map((item) => ({ id: item.lineId, quantity: item.quantity }));
        }
        if (adds.length > 0) {
          args.add_items = adds.map((item) => ({
            product_variant_id: item.variantId,
            quantity: item.quantity,
          }));
        }
        return { tool: "update_cart", args };
      }
      return {
        tool: "update_cart",
        args: {
          id: cartId,
          cart: {
            line_items: items.map((item) => {
              const line: Record<string, unknown> = { quantity: item.quantity };
              if (item.lineId) line.id = item.lineId;
              if (item.variantId) line.item = { id: item.variantId };
              return line;
            }),
          },
        },
      };
    }

    case SHOPIFY_CAPABILITY_IDS.cartRead: {
      const cartId = readRequiredString(input, "cartId", MAX_ID_CHARS);
      return surface === "legacy"
        ? { tool: "get_cart", args: { cart_id: cartId } }
        : { tool: "get_cart", args: { id: cartId } };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Capability descriptors                                                     */
/* -------------------------------------------------------------------------- */

// Not `as const`: these descriptors are handed out as `JsonValue`, which is a
// mutable structural type, so a deeply-readonly literal would not assign.
const lineItemSchema: NormalizedCapability["inputSchema"] = {
  type: "object",
  properties: {
    variantId: { type: "string", maxLength: MAX_ID_CHARS },
    lineId: { type: "string", maxLength: MAX_ID_CHARS },
    quantity: { type: "integer", minimum: 0, maximum: MAX_QUANTITY },
  },
  required: ["quantity"],
  additionalProperties: false,
};

type ShopifyCapabilitySpec = {
  id: ShopifyCapabilityId;
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: NormalizedCapability["inputSchema"];
};

const SHOPIFY_CAPABILITY_SPECS: readonly ShopifyCapabilitySpec[] = [
  {
    id: SHOPIFY_CAPABILITY_IDS.catalogSearch,
    name: "shopify.catalog_search",
    description:
      "Search a configured Shopify storefront's public catalog and return bounded untrusted evidence. Read-only.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS },
        limit: { type: "integer", minimum: 1, maximum: 10 },
        country: { type: "string", maxLength: 8 },
        language: { type: "string", maxLength: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: SHOPIFY_CAPABILITY_IDS.productDetails,
    name: "shopify.product_details",
    description:
      "Read one storefront product by id, optionally selecting variant options, so variants can be compared. Read-only.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", minLength: 1, maxLength: MAX_ID_CHARS },
        options: { type: "object", additionalProperties: { type: "string" } },
        country: { type: "string", maxLength: 8 },
        language: { type: "string", maxLength: 8 },
      },
      required: ["productId"],
      additionalProperties: false,
    },
  },
  {
    id: SHOPIFY_CAPABILITY_IDS.cartPrepare,
    name: "shopify.cart_prepare",
    description:
      "Prepare a new storefront cart from chosen variants. Reversible: it reserves nothing, charges nothing, and completes no checkout.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", minItems: 1, maxItems: MAX_LINE_ITEMS, items: lineItemSchema },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    id: SHOPIFY_CAPABILITY_IDS.cartUpdate,
    name: "shopify.cart_update",
    description:
      "Adjust line quantities on an existing prepared cart, using quantity 0 to remove a line. Reversible and never completes checkout.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        cartId: { type: "string", minLength: 1, maxLength: MAX_ID_CHARS },
        items: { type: "array", minItems: 1, maxItems: MAX_LINE_ITEMS, items: lineItemSchema },
      },
      required: ["cartId", "items"],
      additionalProperties: false,
    },
  },
  {
    id: SHOPIFY_CAPABILITY_IDS.cartRead,
    name: "shopify.cart_read",
    description:
      "Read a prepared cart's current lines and totals, including the storefront checkout URL to hand to the person. Read-only.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { cartId: { type: "string", minLength: 1, maxLength: MAX_ID_CHARS } },
      required: ["cartId"],
      additionalProperties: false,
    },
  },
];

/** The descriptors, without needing a configured store. Used by the canvas and by tests. */
export function describeShopifyCapabilities(storeDomain: string): NormalizedCapability[] {
  return SHOPIFY_CAPABILITY_SPECS.map((spec) => ({
    id: spec.id,
    provider: "shopify",
    name: spec.name,
    // The store is named so the planner can judge relevance: it must know
    // whether the goal's product category is something this storefront could
    // plausibly carry before spending a node on it.
    description: `${spec.description} The configured storefront is ${storeDomain}.`,
    inputSchema: spec.inputSchema,
    risk: {
      // Cart writes are reversible and unpriced, but they are still writes.
      // `external_write` leads the list so the policy engine reads the same
      // action category off this descriptor that the Composio write
      // capabilities declare, rather than falling back to it by default.
      level: spec.readOnly ? "low" : "medium",
      categories: spec.readOnly ? ["read"] : ["external_write", "write", "reversible"],
    },
    trust: {
      level: "derived",
      origin: `https://${storeDomain}`,
      provenance: `shopify:${spec.name}`,
    },
    readOnly: spec.readOnly,
  }));
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the canvas needs to render a truthful section header without ever
 * guessing: configured or not, which store, which surface, and whether that
 * surface is on a published end-of-life path.
 */
export type ShopifyAdapterStatus =
  | {
      configured: true;
      storeDomain: string;
      surface: ShopifySurface;
      deprecation: string | null;
    }
  | { configured: false; reason: string };

export type ShopifyCapabilityAdapterOptions = {
  /** Injectable for tests; defaults to reading `process.env`. */
  env?: Record<string, string | undefined>;
  fetchImpl?: ShopifyFetch;
  now?: () => Date;
  /** Injectable seam so tests never touch the network. */
  call?: (options: {
    config: ShopifyConfig;
    tool: string;
    args: Record<string, unknown>;
  }) => Promise<ShopifyCallResult>;
};

export class ShopifyCapabilityAdapter implements CapabilityAdapter {
  readonly provider = "shopify";

  constructor(private readonly options: ShopifyCapabilityAdapterOptions = {}) {}

  /** Never throws. An unconfigured or misconfigured store is simply invisible. */
  status(): ShopifyAdapterStatus {
    const resolution = resolveShopifyConfig(this.options.env);
    return resolution.configured
      ? {
          configured: true,
          storeDomain: resolution.config.storeDomain,
          surface: resolution.config.surface,
          deprecation: resolution.config.deprecation,
        }
      : { configured: false, reason: resolution.reason };
  }

  async discover(): Promise<NormalizedCapability[]> {
    const resolution = resolveShopifyConfig(this.options.env);
    if (!resolution.configured) return [];
    return describeShopifyCapabilities(resolution.config.storeDomain);
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const resolution = resolveShopifyConfig(this.options.env);
    if (!resolution.configured) {
      throw new CapabilityProviderError(this.provider, "not_configured");
    }
    if (!isShopifyCapabilityId(request.capabilityId)) {
      throw new CapabilityProviderError(this.provider, "tool_not_allowed");
    }

    const config = resolution.config;
    let call: ToolCall;
    try {
      call = buildToolCall(request.capabilityId, config.surface, asRecord(request.input));
    } catch (error) {
      throw new CapabilityProviderError(
        this.provider,
        error instanceof ShopifyInputError ? `invalid_input: ${error.message}` : "invalid_input",
      );
    }

    let result: ShopifyCallResult;
    try {
      result = this.options.call
        ? await this.options.call({ config, tool: call.tool, args: call.args })
        : await callShopifyTool({
            config,
            tool: call.tool,
            args: call.args,
            fetchImpl: this.options.fetchImpl,
            now: this.options.now,
          });
    } catch (error) {
      throw new CapabilityProviderError(
        this.provider,
        error instanceof ShopifyMcpError ? error.reason : "upstream_error",
      );
    }

    const { evidence, refs } = result;
    // `evidence.excerpt` is byte-capped upstream (shopify-mcp-client.ts,
    // outside this harness's ownership boundary) but not content-sanitized:
    // merchant-authored fields like `instructions` ("Assist them in
    // navigating to checkout") survive verbatim otherwise. Neutralize the
    // excerpt text here, right before it reaches the output channel a model
    // or human reads, without touching `evidence.digestSha256` (computed
    // upstream over the ORIGINAL payload, preserved as-is for provenance).
    const { text: sanitizedExcerpt, neutralizedFields } = sanitizeEvidenceExcerptText(
      evidence.excerpt,
    );
    return {
      executionId: request.idempotencyKey,
      output: {
        provider: "shopify",
        storeDomain: evidence.storeDomain,
        tool: evidence.toolSlug,
        excerpt: sanitizedExcerpt,
        digestSha256: evidence.digestSha256,
        bytes: evidence.bytes,
        truncated: evidence.truncated,
        capturedAt: evidence.capturedAt,
        // Recorded, never silent: whether and what this excerpt neutralized.
        sanitized: neutralizedFields.length > 0,
        neutralizedFields,
        // Bounded opaque ids so one capability's result can drive the next.
        // Deliberately carries no prices, copy, or imagery.
        refs: {
          productIds: refs.productIds,
          variantIds: refs.variantIds,
          cartId: refs.cartId,
          lineIds: refs.lineIds,
          continueUrl: refs.continueUrl,
        },
      },
      summary: `Captured bounded untrusted storefront evidence from ${evidence.storeDomain} via ${evidence.toolSlug}.`,
      provenance: evidence.origin,
      trust: "untrusted",
    };
  }
}

export const shopifyCapabilityAdapter = new ShopifyCapabilityAdapter();
