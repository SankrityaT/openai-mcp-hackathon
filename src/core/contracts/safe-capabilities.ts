/**
 * Narrow read-only capabilities a user approves with Cardea's default
 * mandate sheet. Keeping these identifiers in the core contract prevents
 * the browser, planner, and provider adapters from drifting apart.
 */
export const INTERNAL_FIXTURE_CAPABILITY_ID = "internal.echo_research";
export const INTERNAL_FIXTURE_ORIGIN = "https://internal.cardea.local";

/**
 * Cardea's own web lookup: one public webpage, opened in Cardea's remote
 * Cloudflare Browser Run session, read once, and closed. Reviewed as a read
 * capability because it navigates and reads; it types nothing, clicks nothing,
 * and submits nothing.
 *
 * The origin is Cardea's own browser surface rather than the page's origin,
 * and that is deliberate: the mandate authorizes *Cardea's browser*, not an
 * open-ended allowlist of the internet. Which page a node may open is bounded
 * by the adapter's URL rules (public http(s) hosts only), not by the mandate's
 * origin list, which could not enumerate the web.
 */
export const WEB_LOOKUP_CAPABILITY_ID = "cardea.web_lookup";
export const WEB_LOOKUP_ORIGIN = "https://browser.cardea.local";

/**
 * Cardea's own web research: one search, a handful of results chosen from it,
 * and each of those read, all inside the same remote browser session that the
 * lookup uses. It is the discovery half of the same surface, and it shares the
 * lookup's origin for exactly that reason: the mandate authorizes *Cardea's
 * browser*, and a search is that browser opening pages, not a second grant.
 *
 * Still a read. It navigates and reads; it types nothing into a page, clicks
 * nothing, and submits no form. The search query travels in the URL of a
 * server-rendered results page, which is a navigation like any other.
 *
 * Which pages a search may lead to is bounded by the adapter's URL rules
 * (public http(s) hosts only, applied to every decoded result link before it
 * is opened), not by the mandate's origin list, which could not enumerate the
 * web.
 */
export const WEB_RESEARCH_CAPABILITY_ID = "cardea.web_research";

/**
 * Cardea asking the person one concrete preference question, with the two to
 * four short options a plan can actually branch on, and waiting on the board
 * until they answer.
 *
 * Read, not write, and deliberately so. It reaches no account, no site, and no
 * provider: nothing leaves Cardea. What it does spend is the person's
 * attention, and it gates the mission until they give it, which is why it
 * still travels through the mandate as its own reviewed capability with its
 * own origin rather than hiding inside the internal worker.
 *
 * The origin is Cardea's own asking surface. A question is a conversation with
 * the person, so there is no external origin it could honestly name.
 */
export const ASK_USER_CAPABILITY_ID = "cardea.ask_user";
export const ASK_USER_ORIGIN = "https://ask.cardea.local";

export const COMPOSIO_PROVIDER_ORIGIN = "https://composio.dev";

export const COMPOSIO_SAFE_READ_CAPABILITIES = [
  {
    id: "composio.googlecalendar_find_event",
    tool: "GOOGLECALENDAR_FIND_EVENT",
    toolkit: "googlecalendar",
  },
  {
    id: "composio.googlecalendar_find_free_slots",
    tool: "GOOGLECALENDAR_FIND_FREE_SLOTS",
    toolkit: "googlecalendar",
  },
  {
    id: "composio.gmail_fetch_emails",
    tool: "GMAIL_FETCH_EMAILS",
    toolkit: "gmail",
  },
  {
    id: "composio.gmail_fetch_message_by_message_id",
    tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    toolkit: "gmail",
  },
] as const;

/**
 * Write capabilities Cardea may plan with, but may never take on its own.
 * Each id is also enumerated in the mandate's `approvalGatedCapabilityIds`,
 * which is what forces the policy engine onto the approval path no matter
 * what Free Passage says. Deliberately narrow: create a calendar event, and
 * prepare a Gmail draft. Sending mail is not here, and is not a capability
 * Cardea has.
 */
export const COMPOSIO_APPROVAL_GATED_CAPABILITIES = [
  {
    id: "composio.googlecalendar_create_event",
    tool: "GOOGLECALENDAR_CREATE_EVENT",
    toolkit: "googlecalendar",
  },
  {
    id: "composio.gmail_create_email_draft",
    tool: "GMAIL_CREATE_EMAIL_DRAFT",
    toolkit: "gmail",
  },
] as const;

/**
 * Cart preparation, in two layers.
 *
 * The pure layer is `cardea.cart_permalink`: it composes a Shopify cart
 * permalink from variant ids already sitting in evidence. Composing a URL is
 * not a side effect, so it is read-only, low risk, needs no store to be
 * configured, and makes no network call. Its origin is Cardea's own.
 */
export const CART_PERMALINK_CAPABILITY_ID = "cardea.cart_permalink";
export const CART_PERMALINK_ORIGIN = "https://cart.cardea.local";

/**
 * The live layer is the storefront adapter. Its reads stay inside the
 * mandate; its two cart mutations are admitted only through
 * `approvalGatedCapabilityIds`, exactly like the Composio writes, so each one
 * stops at the approval hinge on every attempt. Checkout is not on either
 * list, because Cardea has no checkout capability at all.
 */
export const SHOPIFY_SAFE_READ_CAPABILITY_IDS = [
  "shopify.catalog_search",
  "shopify.product_details",
  "shopify.cart_read",
];

export const SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS = [
  "shopify.cart_prepare",
  "shopify.cart_update",
  // Composed of a search and a cart prepare, so it is gated exactly like the
  // prepare it ends in: a cart appears only after the person approves it.
  "shopify.find_and_prepare_cart",
];

/**
 * The storefront adapter tags every capability with the store's own origin
 * (`https://<store>`), so the mandate can only admit an origin it knows. The
 * store is a deploy-time allowlist of exactly one hostname, never per-call
 * input, and the mandate sheet is built in the browser — hence the public
 * mirror of the server variable. Absent either one, the storefront
 * capabilities are simply never reachable, which is the default everywhere.
 */
export function shopifyStoreOrigin(domain: string | undefined | null): string | null {
  const trimmed = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  return `https://${trimmed}`;
}

const CONFIGURED_SHOPIFY_STORE_ORIGIN = shopifyStoreOrigin(
  typeof process === "undefined"
    ? undefined
    : (process.env.NEXT_PUBLIC_CARDEA_SHOPIFY_STORE_DOMAIN ??
        process.env.CARDEA_SHOPIFY_STORE_DOMAIN),
);

export const DEFAULT_APPROVAL_GATED_CAPABILITY_IDS = [
  ...COMPOSIO_APPROVAL_GATED_CAPABILITIES.map((capability) => capability.id),
  ...SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS,
];

export const DEFAULT_SAFE_CAPABILITY_IDS = [
  INTERNAL_FIXTURE_CAPABILITY_ID,
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_RESEARCH_CAPABILITY_ID,
  ASK_USER_CAPABILITY_ID,
  ...COMPOSIO_SAFE_READ_CAPABILITIES.map((capability) => capability.id),
  CART_PERMALINK_CAPABILITY_ID,
  ...SHOPIFY_SAFE_READ_CAPABILITY_IDS,
];

export const DEFAULT_SAFE_CAPABILITY_ORIGINS = [
  INTERNAL_FIXTURE_ORIGIN,
  WEB_LOOKUP_ORIGIN,
  ASK_USER_ORIGIN,
  COMPOSIO_PROVIDER_ORIGIN,
  CART_PERMALINK_ORIGIN,
  ...(CONFIGURED_SHOPIFY_STORE_ORIGIN ? [CONFIGURED_SHOPIFY_STORE_ORIGIN] : []),
];

