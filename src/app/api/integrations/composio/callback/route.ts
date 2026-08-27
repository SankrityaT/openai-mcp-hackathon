import { cookies } from "next/headers";

import { COMPOSIO_OAUTH_NONCE_COOKIE, completeComposioAuthorization } from "@/harness/adapters/composio";
import { sendNodeRequested } from "@/harness/inngest/dispatch";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Must match the `path` the authorize route used to set the nonce cookie
// (`COMPOSIO_OAUTH_NONCE_COOKIE`) exactly, or the clearing `Set-Cookie`
// below targets a different cookie and the original never actually clears.
const CALLBACK_PATH = "/api/integrations/composio/callback";

function redirectToCanvas(appOrigin: string, params: Record<string, string>) {
  const url = new URL("/app", appOrigin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

/**
 * GET /api/integrations/composio/callback?state=...
 *
 * Verifies the signed state (expiry + exact-user binding via
 * `verifyComposioState`), confirms the resulting connection status through
 * Composio, and redirects back to `/canvas` with a bounded status query
 * param (`?integration=<toolkit>&status=connected|pending|error|...`).
 *
 * Never stores or echoes a provider token. The connection reference
 * returned here is intentionally ephemeral (carried only in the redirect
 * query string for this one round trip) — persisting a durable connector
 * reference across sessions would need a new Supabase table (e.g.
 * `connector_refs`, tenant-scoped like `memory_refs`) that does not exist
 * yet in `docs/CORE_DATA_POLICY.md`; adding one is out of this ticket's
 * file-ownership scope.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appOrigin = process.env.CARDEA_APP_ORIGIN ?? requestUrl.origin;
  const state = requestUrl.searchParams.get("state");

  try {
    if (!state) {
      return redirectToCanvas(appOrigin, { integration: "composio", status: "error" });
    }

    const client = await createSupabaseServerClient();
    let userId: string;
    try {
      ({ userId } = await requireAuthenticatedUser(client));
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return redirectToCanvas(appOrigin, { integration: "composio", status: "unauthenticated" });
      }
      throw error;
    }

    // Read, then immediately clear, the double-submit nonce cookie: this is
    // what makes the state token single-use. Whether verification below
    // succeeds or fails, the cookie must never survive to be reused by a
    // second callback for the same `state`. A missing cookie (direct hit,
    // expired, or an already-consumed replay) is passed through as an empty
    // string, which `verifyComposioState` never matches.
    const cookieStore = await cookies();
    const nonce = cookieStore.get(COMPOSIO_OAUTH_NONCE_COOKIE)?.value ?? "";
    cookieStore.delete({ name: COMPOSIO_OAUTH_NONCE_COOKIE, path: CALLBACK_PATH });

    const result = await completeComposioAuthorization({ userId, state, nonce });
    if (!result.available) {
      return redirectToCanvas(appOrigin, { integration: "composio", status: "not_configured" });
    }
    let resumed = false;
    if (result.connected && result.missionId && result.nodeId) {
      const snapshot = await new SupabaseMissionRepository(client).getMission(result.missionId);
      const node = snapshot?.nodes.find((candidate) => candidate.id === result.nodeId);
      if (snapshot && node) {
        const dispatched = await sendNodeRequested({
          missionId: snapshot.mission.id,
          tenantId: snapshot.mission.tenantId,
          identityId: userId,
          nodeId: node.id,
          node: {
            clientId: node.id,
            codename: node.codename,
            roleLabel: node.roleLabel,
            objective: node.objective,
            capabilityNames: node.requiredCapabilities.map((capability) => capability.name),
            capabilityInputs: Object.fromEntries(
              node.requiredCapabilities
                .filter((capability) => capability.constraints !== undefined)
                .map((capability) => [capability.name, capability.constraints!]),
            ),
          },
          mandateVersion: snapshot.mandate.version,
          expectedSequence: snapshot.latestSequence,
          authority: snapshot.mandate.authority,
          budgetLimits: snapshot.mission.budgetLimits,
          actor: { kind: "user", id: userId },
          correlationId: crypto.randomUUID(),
        });
        resumed = dispatched.dispatched;
      }
    }
    return redirectToCanvas(appOrigin, {
      integration: result.toolkit,
      status: result.connected ? "connected" : "pending",
      ...(resumed ? { resumed: "1" } : {}),
    });
  } catch {
    return redirectToCanvas(appOrigin, { integration: "composio", status: "error" });
  }
}
