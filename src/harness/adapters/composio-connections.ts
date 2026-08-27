/**
 * Per-user Google account connections through Composio managed OAuth.
 *
 * Deliberately free of `server-only` and of any `@composio/*` import, for the
 * same reason `composio-support.ts` is: the provider client arrives as an
 * injected {@link ComposioConnectionsClient}, so every rule below is
 * exercised by plain `node --test` against a dummy rather than asserted by
 * hand. The env-backed client factory lives in `composio-connections-client.ts`,
 * which is the server-only half.
 *
 * Identity: the Composio entity id is ALWAYS the Supabase `auth.users.id`
 * UUID of the caller, passed in by the route after
 * `requireAuthenticatedUser`. There is no other entity vocabulary in Cardea,
 * and no request field can influence it.
 *
 * Secrets: Google access and refresh tokens are held by Composio. Cardea
 * never requests, receives, stores, or logs them, and `COMPOSIO_API_KEY`
 * stays inside the client factory. Everything returned here passes through
 * `toPublicConnection*`, which builds a fixed shape rather than forwarding a
 * provider payload.
 *
 * Ownership: every read and every mutation is filtered by
 * `userIds: [entityId]` before anything else happens, so a connection id
 * belonging to another user is not "forbidden", it is absent — and callers
 * turn absence into a 404 rather than a 403 that would confirm it exists.
 */
import {
  authConfigNameForToolkit,
  COMPOSIO_CONNECTION_TOOLKITS,
  findOwnedConnection,
  toPublicConnection,
  toPublicConnectionList,
  type ComposioConnectionToolkit,
  type PublicComposioConnection,
  type RawComposioConnection,
} from "./composio-connection-contract";

const AUTH_CONFIG_SEARCH_LIMIT = 50;
const CONNECTION_LIST_LIMIT = 50;

/**
 * The narrow slice of the Composio SDK this module uses. Method names and
 * argument order match `@composio/core` 0.17.0 exactly: `authConfigs.list`,
 * `connectedAccounts.list`, `connectedAccounts.link`,
 * `connectedAccounts.delete`.
 *
 * `link` rather than the older `initiate`: the legacy connected-accounts
 * endpoint is being retired for Composio-managed OAuth (see the deprecation
 * note on `ConnectedAccounts.initiate` in the installed SDK), and `link`
 * covers every redirectable scheme regardless of who manages the auth config.
 */
export type ComposioConnectionsClient = {
  authConfigs: {
    list(query: {
      toolkit?: string;
      search?: string;
      limit?: number;
    }): Promise<{ items: readonly { id: string; name: string; status?: string }[] }>;
  };
  connectedAccounts: {
    list(query: {
      userIds?: string[];
      toolkitSlugs?: string[];
      limit?: number;
    }): Promise<{ items: readonly RawComposioConnection[] }>;
    link(
      userId: string,
      authConfigId: string,
      options?: { callbackUrl?: string },
    ): Promise<{ id: string; redirectUrl?: string | null }>;
    delete(connectedAccountId: string): Promise<unknown>;
  };
};

/**
 * Resolves the operator's preconfigured auth config for a toolkit by its
 * EXACT name (`cardea-gmail` / `cardea-calendar`). A near match is never
 * accepted and a disabled config is never used: if the named config is
 * missing, the connect flow says so rather than silently falling back to
 * whatever other OAuth app happens to exist for that toolkit.
 */
export async function resolveComposioAuthConfigId(
  client: ComposioConnectionsClient,
  toolkit: ComposioConnectionToolkit,
): Promise<string | null> {
  const name = authConfigNameForToolkit(toolkit);
  const result = await client.authConfigs.list({
    toolkit,
    search: name,
    limit: AUTH_CONFIG_SEARCH_LIMIT,
  });
  const match = result.items.find(
    (item) => item.name === name && (item.status ?? "ENABLED") !== "DISABLED",
  );
  return match ? match.id : null;
}

/** The caller's own connections, and only ever the caller's own. */
export async function readOwnComposioConnections(
  client: ComposioConnectionsClient,
  entityId: string,
): Promise<readonly RawComposioConnection[]> {
  const result = await client.connectedAccounts.list({
    userIds: [entityId],
    toolkitSlugs: [...COMPOSIO_CONNECTION_TOOLKITS],
    limit: CONNECTION_LIST_LIMIT,
  });
  return result.items;
}

/** Every offered toolkit with this user's own status. Never another user's. */
export async function listComposioConnections(
  client: ComposioConnectionsClient,
  entityId: string,
): Promise<PublicComposioConnection[]> {
  return toPublicConnectionList(await readOwnComposioConnections(client, entityId));
}

export type StartConnectionResult =
  | { outcome: "redirect"; redirectUrl: string; connection: PublicComposioConnection }
  | { outcome: "already_connected"; connection: PublicComposioConnection }
  | { outcome: "auth_config_missing" }
  | { outcome: "no_redirect_url" };

/**
 * Starts (or short-circuits) a managed-OAuth connect for one toolkit.
 *
 * A second connect attempt while a live connection already exists is not an
 * error: it returns the existing connection so the surface can simply show
 * it, which is what a person double-clicking "Connect" actually wants.
 */
export async function startComposioConnection(
  client: ComposioConnectionsClient,
  input: { entityId: string; toolkit: ComposioConnectionToolkit; callbackUrl: string },
): Promise<StartConnectionResult> {
  const existing = toPublicConnectionList(
    await readOwnComposioConnections(client, input.entityId),
  ).find((entry) => entry.toolkit === input.toolkit);
  if (existing && existing.status === "connected") {
    return { outcome: "already_connected", connection: existing };
  }

  const authConfigId = await resolveComposioAuthConfigId(client, input.toolkit);
  if (!authConfigId) return { outcome: "auth_config_missing" };

  const request = await client.connectedAccounts.link(input.entityId, authConfigId, {
    callbackUrl: input.callbackUrl,
  });
  if (!request.redirectUrl) return { outcome: "no_redirect_url" };

  return {
    outcome: "redirect",
    redirectUrl: request.redirectUrl,
    connection: toPublicConnection(input.toolkit, { id: request.id, status: "INITIATED" }),
  };
}

export type DisconnectResult = { outcome: "disconnected" } | { outcome: "not_found" };

/**
 * Removes one of the caller's own connections. The id is matched against the
 * caller's own entity listing first, so another user's connection id is
 * reported as missing and no delete is ever attempted for it.
 */
export async function disconnectComposioConnection(
  client: ComposioConnectionsClient,
  input: { entityId: string; connectionId: string },
): Promise<DisconnectResult> {
  const owned = findOwnedConnection(
    await readOwnComposioConnections(client, input.entityId),
    input.connectionId,
  );
  if (!owned) return { outcome: "not_found" };

  await client.connectedAccounts.delete(owned.id);
  return { outcome: "disconnected" };
}
