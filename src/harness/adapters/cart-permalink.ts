/**
 * Cart permalink composer.
 *
 * Shopify publishes a permalink form that every storefront answers without an
 * API, a token, or an app:
 *
 *     https://<store>/cart/<variant_id>:<quantity>[,<variant_id>:<quantity>...]
 *
 * Opening it lands the person on the merchant's own store with the cart
 * already filled. That is the whole capability. It composes a string from
 * variant ids that are already sitting in mission evidence and returns it.
 *
 * WHY THIS IS READ-ONLY. Composing a URL touches nothing: no request leaves
 * the process, no cart exists until the person opens the link themselves, and
 * nothing is reserved, charged, or committed. The consequential act stays
 * where it belongs — with the human, on the merchant's own checkout. So the
 * capability is `readOnly: true`, low risk, category "read", and its origin is
 * Cardea's own rather than any storefront's.
 *
 * WHY IT IS SEPARATE FROM THE STOREFRONT ADAPTER. The storefront adapter is
 * env-gated on one configured store and needs that store to have Shopify's
 * storefront MCP surface answering. This one needs neither. It works for any
 * store whose product pages exposed numeric variant ids, which is how a
 * research node actually finds them, and it keeps working when no Shopify
 * configuration exists at all.
 *
 * TRUST. The descriptor is "derived" (Cardea owns this deterministic
 * function). The composed URL is likewise derived, not untrusted: every byte
 * of it is either a validated hostname or a validated digit string that this
 * module wrote itself. The *variant ids* came from untrusted evidence, which
 * is precisely why they are validated to be digits and nothing else before
 * they reach the string.
 */
import { CapabilityProviderError } from "../capability-errors";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";
import {
  CART_PERMALINK_CAPABILITY_ID,
  CART_PERMALINK_ORIGIN,
} from "../../core/contracts/safe-capabilities";

export { CART_PERMALINK_CAPABILITY_ID, CART_PERMALINK_ORIGIN };

export const CART_PERMALINK_PROVIDER = "cardea-cart";

/** Shopify's permalink parser reads a comma-separated list; keep it short. */
export const CART_PERMALINK_MAX_ITEMS = 10;
export const CART_PERMALINK_MAX_QUANTITY = 10;
const MAX_STORE_CHARS = 253;
const MAX_VARIANT_ID_CHARS = 32;

export class CartPermalinkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartPermalinkInputError";
  }
}

export type CartPermalinkItem = { variantId: string; quantity: number };
export type CartPermalinkInput = { store: string; items: CartPermalinkItem[] };

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Accepts a bare hostname only: no scheme, no port, no path, no credentials,
 * no wildcard. Anything else is refused rather than coerced, because a
 * coerced host is how a composed URL stops pointing at the store the person
 * named. Mirrors the storefront client's own domain rule.
 */
export function normalizeCartStore(raw: unknown): string {
  if (typeof raw !== "string") throw new CartPermalinkInputError('"store" must be a string.');
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) throw new CartPermalinkInputError('"store" is required.');
  if (trimmed.length > MAX_STORE_CHARS) {
    throw new CartPermalinkInputError(`"store" exceeds ${MAX_STORE_CHARS} characters.`);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    throw new CartPermalinkInputError(
      '"store" must be a bare storefront hostname such as example.com, with no scheme, port, or path.',
    );
  }
  return trimmed;
}

/**
 * Shopify permalinks address the *numeric* legacy variant id, not the
 * `gid://shopify/ProductVariant/...` global id. Only digits are accepted, so
 * nothing a merchant or a page authored can smuggle a delimiter, a path
 * segment, or a query string into the composed URL.
 */
export function normalizeVariantId(raw: unknown): string {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new CartPermalinkInputError('Each item "variantId" must be a positive numeric id.');
    }
    return String(raw);
  }
  if (typeof raw !== "string") {
    throw new CartPermalinkInputError('Each item needs a "variantId".');
  }
  const trimmed = raw.trim();
  if (!/^[0-9]{1,32}$/.test(trimmed)) {
    throw new CartPermalinkInputError(
      'Each item "variantId" must be the storefront\'s numeric variant id, digits only.',
    );
  }
  if (trimmed.length > MAX_VARIANT_ID_CHARS) {
    throw new CartPermalinkInputError(`"variantId" exceeds ${MAX_VARIANT_ID_CHARS} characters.`);
  }
  return trimmed;
}

function normalizeQuantity(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (
    raw === undefined ||
    raw === null ||
    raw === "" ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > CART_PERMALINK_MAX_QUANTITY
  ) {
    throw new CartPermalinkInputError(
      `Each item "quantity" must be an integer between 1 and ${CART_PERMALINK_MAX_QUANTITY}.`,
    );
  }
  return parsed;
}

export function parseCartPermalinkInput(input: unknown): CartPermalinkInput {
  const source = asRecord(input);
  const store = normalizeCartStore(source.store);
  const raw = source.items;
  if (!Array.isArray(raw)) throw new CartPermalinkInputError('"items" must be an array.');
  if (raw.length < 1) throw new CartPermalinkInputError('"items" must contain at least one entry.');
  if (raw.length > CART_PERMALINK_MAX_ITEMS) {
    throw new CartPermalinkInputError(
      `"items" may contain at most ${CART_PERMALINK_MAX_ITEMS} entries.`,
    );
  }
  const items = raw.map((entry) => {
    const record = asRecord(entry);
    return {
      variantId: normalizeVariantId(record.variantId),
      quantity: normalizeQuantity(record.quantity),
    };
  });
  return { store, items };
}

/** Composes the permalink. Pure: no network, no clock, no randomness. */
export function composeCartPermalink(input: CartPermalinkInput): string {
  const pairs = input.items.map((item) => `${item.variantId}:${item.quantity}`).join(",");
  return `https://${input.store}/cart/${pairs}`;
}

const CART_PERMALINK_DESCRIPTION =
  "composes a Shopify cart permalink from variant ids found in evidence, so the person lands on the store with the cart pre-filled; only for stores whose product pages exposed numeric variant ids";

const inputSchema: NormalizedCapability["inputSchema"] = {
  type: "object",
  properties: {
    store: { type: "string", minLength: 3, maxLength: MAX_STORE_CHARS },
    items: {
      type: "array",
      minItems: 1,
      maxItems: CART_PERMALINK_MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          variantId: { type: "string", pattern: "^[0-9]{1,32}$", maxLength: MAX_VARIANT_ID_CHARS },
          quantity: { type: "integer", minimum: 1, maximum: CART_PERMALINK_MAX_QUANTITY },
        },
        required: ["variantId", "quantity"],
        additionalProperties: false,
      },
    },
  },
  required: ["store", "items"],
  additionalProperties: false,
};

export function describeCartPermalinkCapability(): NormalizedCapability {
  return {
    id: CART_PERMALINK_CAPABILITY_ID,
    provider: CART_PERMALINK_PROVIDER,
    name: CART_PERMALINK_CAPABILITY_ID,
    description: CART_PERMALINK_DESCRIPTION,
    inputSchema,
    outputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    risk: { level: "low", categories: ["read"] },
    trust: {
      level: "derived",
      origin: CART_PERMALINK_ORIGIN,
      provenance: "cardea:cart_permalink",
    },
    readOnly: true,
  };
}

export class CartPermalinkAdapter implements CapabilityAdapter {
  readonly provider = CART_PERMALINK_PROVIDER;

  /** Always available: it depends on no configuration and no network. */
  async discover(): Promise<NormalizedCapability[]> {
    return [describeCartPermalinkCapability()];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    if (request.capabilityId !== CART_PERMALINK_CAPABILITY_ID) {
      throw new CapabilityProviderError(this.provider, "tool_not_allowed");
    }

    let parsed: CartPermalinkInput;
    try {
      parsed = parseCartPermalinkInput(request.input);
    } catch (error) {
      throw new CapabilityProviderError(
        this.provider,
        error instanceof CartPermalinkInputError
          ? `invalid_input: ${error.message}`
          : "invalid_input",
      );
    }

    const url = composeCartPermalink(parsed);
    return {
      executionId: request.idempotencyKey,
      output: { url },
      summary: `prepared a cart link at ${parsed.store} with ${parsed.items.length} items`,
      provenance: CART_PERMALINK_ORIGIN,
      trust: "derived",
    };
  }
}

export const cartPermalinkAdapter = new CartPermalinkAdapter();
