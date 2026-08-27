import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/core/database.types";
import type {
  ComposioConnectionStatus,
  ComposioConnectionToolkit,
} from "@/harness/adapters/composio-connection-contract";

/**
 * Best-effort metadata for a user's Composio connections.
 *
 * Composio remains the source of truth for whether a connection is live: the
 * settings surface reads its status from the provider, not from here. This
 * table only records that a Cardea user started or dropped a connection, so
 * the row is a note rather than a decision input. That is why every write is
 * deliberately non-fatal — a deployment that has not yet applied
 * 20260827000100_composio_connections.sql still connects and disconnects
 * correctly, it simply keeps no note.
 *
 * Nothing credential-bearing passes through here. `connectedAccountId` is an
 * opaque Composio handle; there is no token, code, or scope in this module's
 * vocabulary, and failures are swallowed without echoing the payload.
 *
 * Writes go through the caller's own RLS-scoped client, so the row is bound
 * to `auth.uid()` twice over: once by the value written and once by the
 * insert/update policy.
 */

type Client = SupabaseClient<Database>;

export async function recordComposioConnection(
  client: Client,
  input: {
    userId: string;
    toolkit: ComposioConnectionToolkit;
    connectedAccountId: string;
    status: ComposioConnectionStatus;
  },
): Promise<void> {
  try {
    await client.from("composio_connections").upsert(
      {
        user_id: input.userId,
        toolkit: input.toolkit,
        connected_account_id: input.connectedAccountId,
        status: input.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,toolkit" },
    );
  } catch {
    // Non-fatal by design; see the note above.
  }
}

export async function markComposioConnectionDisconnected(
  client: Client,
  input: { userId: string; connectedAccountId: string },
): Promise<void> {
  try {
    await client
      .from("composio_connections")
      .update({ status: "disconnected", updated_at: new Date().toISOString() })
      // Both predicates matter: the user filter is what RLS enforces anyway,
      // and the account filter keeps a stale row for another toolkit intact.
      .eq("user_id", input.userId)
      .eq("connected_account_id", input.connectedAccountId);
  } catch {
    // Non-fatal by design; see the note above.
  }
}
