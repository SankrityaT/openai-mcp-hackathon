import "server-only";

import { Composio } from "@composio/core";
import type { ComposioConnectionsClient } from "./composio-connections";

/**
 * The server-only half of the connections adapter: the one place
 * `COMPOSIO_API_KEY` is read. It is never returned, echoed, or embedded in a
 * response, and no client component imports this module.
 *
 * Returns null when the key is absent so callers can render an honest "not
 * configured" state instead of failing a request that was never going to
 * reach a provider.
 */
export function createComposioConnectionsClient(): ComposioConnectionsClient | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  // The real SDK surface is a superset of `ComposioConnectionsClient`; the
  // cast narrows it to exactly what the adapter is allowed to reach for.
  return new Composio({ apiKey }) as unknown as ComposioConnectionsClient;
}
