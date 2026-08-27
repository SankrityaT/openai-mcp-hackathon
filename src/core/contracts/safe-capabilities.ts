/**
 * Narrow read-only capabilities a user approves with Cardea's default
 * mandate sheet. Keeping these identifiers in the core contract prevents
 * the browser, planner, and provider adapters from drifting apart.
 */
export const INTERNAL_FIXTURE_CAPABILITY_ID = "internal.echo_research";
export const INTERNAL_FIXTURE_ORIGIN = "https://internal.cardea.local";

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

export const DEFAULT_SAFE_CAPABILITY_IDS = [
  INTERNAL_FIXTURE_CAPABILITY_ID,
  ...COMPOSIO_SAFE_READ_CAPABILITIES.map((capability) => capability.id),
];

export const DEFAULT_SAFE_CAPABILITY_ORIGINS = [
  INTERNAL_FIXTURE_ORIGIN,
  COMPOSIO_PROVIDER_ORIGIN,
];

