import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/core/database.types";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ConnectionPrincipal } from "./connect-request";

/**
 * Authenticated, request-scoped context for the Composio connection routes.
 *
 * `requireAuthenticatedUser` is the only door: a judge code and a guest
 * session carry no Supabase session, so both fall through to
 * `AuthenticationRequiredError` and a 401 exactly like an anonymous visitor.
 * That is intended, not incidental. Judge and guest access exist so a person
 * can run a mission without an account, and there is no account to connect
 * Google to. Neither path is otherwise touched by these routes.
 *
 * `ensureUserTenant` runs here rather than in each route so the integrations
 * flow always goes through first-login provisioning. The RPC is idempotent
 * (`insert ... on conflict do nothing` in
 * 20260826000200_transactions_and_guards.sql), so calling it on every
 * connection request costs one round trip and never creates a second tenant.
 */
export async function createConnectionContext(): Promise<{
  client: SupabaseClient<Database>;
  principal: ConnectionPrincipal;
  /** The Composio entity id. Always the Supabase `auth.users.id` UUID. */
  entityId: string;
}> {
  const client = await createSupabaseServerClient();
  const { userId } = await requireAuthenticatedUser(client);
  await new SupabaseMissionRepository(client).ensureUserTenant();
  return { client, principal: { kind: "user", userId }, entityId: userId };
}

/** Cardea's own origin, the only place a connect flow is allowed to return to. */
export function readAppOrigin(request: Request): string {
  return process.env.CARDEA_APP_ORIGIN ?? new URL(request.url).origin;
}
