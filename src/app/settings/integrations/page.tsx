import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { listComposioConnections } from "@/harness/adapters/composio-connections";
import { createComposioConnectionsClient } from "@/harness/adapters/composio-connections-client";
import {
  COMPOSIO_CONNECTION_LABELS,
  isComposioConnectionToolkit,
  toPublicConnectionList,
  type PublicComposioConnection,
} from "@/harness/adapters/composio-connection-contract";
import { IntegrationsView } from "./_components/integrations-view";

export const metadata: Metadata = {
  title: "Connected services",
  description: "Connect Gmail and Google Calendar to Cardea.",
};

const SIGN_IN_PATH = "/signin?next=%2Fsettings%2Fintegrations";

/**
 * The return notice after a managed-OAuth round trip.
 *
 * Composio appends `status=success|failed` to the callback URL, and Cardea
 * adds the toolkit marker. A cancelled or refused consent screen is an
 * ordinary outcome, not an error state, so it gets one plain sentence rather
 * than an alarm.
 */
function readNotice(params: Record<string, string | string[] | undefined>): string | null {
  const rawToolkit = Array.isArray(params.toolkit) ? params.toolkit[0] : params.toolkit;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  if (!isComposioConnectionToolkit(rawToolkit)) return null;
  const label = COMPOSIO_CONNECTION_LABELS[rawToolkit];
  if (rawStatus === "success") return `${label} is connected.`;
  if (rawStatus === "failed") return `${label} was not connected. Nothing changed.`;
  return null;
}

/**
 * Connected services.
 *
 * Server-gated: an unauthenticated visitor is sent to /signin with a bounded
 * same-origin `next`, so the page never renders a half-state for someone
 * whose session expired mid-flow. Status is read live from Composio, which
 * owns the tokens; Cardea holds none.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const client = await createSupabaseServerClient();
  let userId: string;
  try {
    ({ userId } = await requireAuthenticatedUser(client));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect(SIGN_IN_PATH);
    throw error;
  }

  // First authenticated use provisions the personal tenant. Idempotent, so a
  // returning visitor pays one round trip and gains no second tenant.
  await new SupabaseMissionRepository(client).ensureUserTenant();

  // A provider failure must degrade to a visible message, never a server
  // error page: the first production visit found the Composio key missing
  // read permission on connected_accounts, and the page fell over with it.
  const composio = createComposioConnectionsClient();
  let connections: PublicComposioConnection[] = toPublicConnectionList([]);
  let statusNotice: string | null = null;
  if (composio) {
    try {
      connections = await listComposioConnections(composio, userId);
    } catch {
      statusNotice =
        "Connection status could not be read from Composio just now. Connecting may still work; status will appear once the provider responds.";
    }
  }

  return (
    <IntegrationsView
      configured={composio !== null}
      connections={connections}
      notice={statusNotice ?? readNotice(await searchParams)}
    />
  );
}
