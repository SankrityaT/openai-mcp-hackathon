/**
 * Pure contract for the per-user Composio account connections surface.
 *
 * Deliberately dependency-free (no `@composio/*`, no `server-only`, no
 * Supabase) so the rules that actually matter are covered by plain
 * `node --test`: which toolkits exist, which named auth config each one is
 * allowed to use, how a provider status becomes a Cardea status, and — most
 * importantly — the exact, closed shape that ever leaves the server.
 *
 * Cardea never sees, stores, or forwards a Google token. Composio owns the
 * tokens. {@link toPublicConnection} is the only way a connection reaches a
 * response body, and it builds a fresh object from a fixed field list rather
 * than spreading a provider payload, so a new provider field can never leak
 * by accident.
 */

/** The only toolkits Cardea offers as user-connectable accounts. */
export const COMPOSIO_CONNECTION_TOOLKITS = ["gmail", "googlecalendar"] as const;
export type ComposioConnectionToolkit = (typeof COMPOSIO_CONNECTION_TOOLKITS)[number];

/**
 * The preconfigured Composio auth configs, by exact name. Connect flows may
 * use these two and nothing else: resolving by name (rather than letting
 * Composio pick a default for a toolkit slug) keeps every Cardea connection
 * on the reviewed, operator-owned OAuth apps.
 */
export const COMPOSIO_AUTH_CONFIG_NAMES = {
  gmail: "cardea-gmail",
  googlecalendar: "cardea-calendar",
} as const satisfies Record<ComposioConnectionToolkit, string>;

/** Human labels for the integrations surface. Sentence-cased product names. */
export const COMPOSIO_CONNECTION_LABELS = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
} as const satisfies Record<ComposioConnectionToolkit, string>;

export function isComposioConnectionToolkit(value: unknown): value is ComposioConnectionToolkit {
  return (
    typeof value === "string" &&
    (COMPOSIO_CONNECTION_TOOLKITS as readonly string[]).includes(value)
  );
}

export function authConfigNameForToolkit(toolkit: ComposioConnectionToolkit): string {
  return COMPOSIO_AUTH_CONFIG_NAMES[toolkit];
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Composio's connected-account status vocabulary, as of @composio/core 0.17.0. */
export type ComposioProviderStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "FAILED"
  | "EXPIRED"
  | "INACTIVE"
  | "REVOKED";

/**
 * What a person sees. Narrower than the provider vocabulary on purpose: the
 * settings surface is a small quiet list, not a status console.
 */
export type ComposioConnectionStatus = "connected" | "pending" | "disconnected" | "error";

export function toConnectionStatus(providerStatus: string | null | undefined): ComposioConnectionStatus {
  switch (providerStatus) {
    case "ACTIVE":
      return "connected";
    case "INITIALIZING":
    case "INITIATED":
      return "pending";
    case "FAILED":
    case "EXPIRED":
      return "error";
    default:
      // INACTIVE, REVOKED, and anything a future provider version adds all
      // read as "not connected" rather than as an unexplained new state.
      return "disconnected";
  }
}

// ---------------------------------------------------------------------------
// The only shape that leaves the server
// ---------------------------------------------------------------------------

export type PublicComposioConnection = {
  toolkit: ComposioConnectionToolkit;
  label: string;
  status: ComposioConnectionStatus;
  /** Composio's connected-account id. Not a credential; scoped to one user. */
  connectionId: string | null;
  connectedAt: string | null;
};

/**
 * Raw provider connection as this module needs to read it. Kept structural so
 * neither this file nor its tests import the Composio SDK.
 */
export type RawComposioConnection = {
  id: string;
  status?: string | null;
  toolkit?: { slug?: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/**
 * Builds the public shape from a fixed field list. Never spreads the provider
 * object, so `state`, `data`, `params`, and any future credential-bearing
 * field are structurally impossible to include.
 */
export function toPublicConnection(
  toolkit: ComposioConnectionToolkit,
  connection: RawComposioConnection | null,
): PublicComposioConnection {
  const status = connection ? toConnectionStatus(connection.status) : "disconnected";
  return {
    toolkit,
    label: COMPOSIO_CONNECTION_LABELS[toolkit],
    status,
    connectionId: connection ? connection.id : null,
    connectedAt: status === "connected" ? (connection?.updatedAt ?? connection?.createdAt ?? null) : null,
  };
}

/**
 * One entry per offered toolkit, in a stable order, whether or not the user
 * has a connection. The page renders exactly this list, so a missing
 * connection is an ordinary "disconnected" row rather than a gap.
 *
 * When a user somehow has several connections for one toolkit (multi-account
 * is not offered here, but a stale record can survive a disconnect), the
 * strongest one wins so the surface never shows "disconnected" for an account
 * that is in fact live.
 */
const STATUS_RANK: Record<ComposioConnectionStatus, number> = {
  connected: 3,
  pending: 2,
  error: 1,
  disconnected: 0,
};

export function toPublicConnectionList(
  connections: readonly RawComposioConnection[],
): PublicComposioConnection[] {
  return COMPOSIO_CONNECTION_TOOLKITS.map((toolkit) => {
    const candidates = connections.filter((entry) => entry.toolkit?.slug === toolkit);
    const best = candidates.reduce<RawComposioConnection | null>((winner, entry) => {
      if (!winner) return entry;
      return STATUS_RANK[toConnectionStatus(entry.status)] >
        STATUS_RANK[toConnectionStatus(winner.status)]
        ? entry
        : winner;
    }, null);
    return toPublicConnection(toolkit, best);
  });
}

/**
 * Membership test that gives per-user scoping its teeth: a connection id the
 * caller's own entity does not own is simply absent, and callers turn that
 * into a 404 rather than a 403 that would confirm the id exists.
 */
export function findOwnedConnection(
  connections: readonly RawComposioConnection[],
  connectionId: string,
): RawComposioConnection | null {
  return connections.find((entry) => entry.id === connectionId) ?? null;
}
