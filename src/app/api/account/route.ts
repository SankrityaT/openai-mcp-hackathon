import {
  ACCOUNT_DELETION_CONFIRMATION,
  denyAccountDeletionConfirmation,
  denyAccountDeletionPrincipal,
} from "@/core/server/account-deletion";
import { RedactedDatabaseError } from "@/core/server/database";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { resolveMissionPrincipal } from "@/core/server/mission-principal";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * DELETE /api/account — erase the calling account and everything it owns.
 *
 * The door is `resolveMissionPrincipal`: only a `user` principal, a real
 * signed-in Supabase account, has anything to erase. Guest sessions, judge
 * codes, and anonymous visitors get 401 with a reason that says plainly there
 * is no account behind that session, instead of a vague forbidden that would
 * imply one exists. The subject is always the caller's own `auth.users` row,
 * read from the verified session claims; no client-supplied id is ever read,
 * so this route cannot be pointed at somebody else's account.
 *
 * Order matters. `public.tenants.owner_user_id` is `on delete restrict`
 * (`supabase/migrations/20260826000100_core_schema.sql`), so deleting the auth
 * user first would fail on the tenant that still points at it. Owned tenants
 * go first; each one cascades through missions, nodes, edges, events,
 * checkpoints, approvals, tool runs, capability sources, context cards,
 * memory refs, usage ledger rows, guest sessions, and judge access. That
 * cascade only became possible with
 * `supabase/migrations/20260827150000_cascade_erasure.sql`, which lets
 * `private.reject_mutation()` pass a DELETE that arrives nested inside the
 * foreign-key cascade while still rejecting direct writes to the append-only
 * tables. The auth user is deleted last, which cascades the remaining
 * per-user rows: memberships, Composio connections, standing missions, and
 * notification channels.
 *
 * A partial failure leaves the account intact rather than half-erased: if the
 * tenant deletion fails the auth user is never touched, and the caller sees an
 * error instead of a 204 they cannot trust.
 */
export async function DELETE(request: Request) {
  try {
    const limited = enforceRateLimit("account_deletion", readIpSignalHash(request));
    if (limited) return limited;

    const principal = await resolveMissionPrincipal();
    const principalDenial = denyAccountDeletionPrincipal(principal.kind);
    if (principalDenial) {
      return jsonResponse(
        { error: principalDenial.error, reason: principalDenial.reason },
        { status: principalDenial.status },
      );
    }
    const userId = (principal as Extract<typeof principal, { kind: "user" }>).userId;

    // A body that is not JSON at all is the same answer as a body with the
    // wrong phrase: this is not confirmed, so nothing is deleted.
    const body = await request.json().catch(() => undefined);
    const confirmationDenial = denyAccountDeletionConfirmation(body);
    if (confirmationDenial) {
      return jsonResponse(
        {
          error: confirmationDenial.error,
          reason: confirmationDenial.reason,
          expected: ACCOUNT_DELETION_CONFIRMATION,
        },
        { status: confirmationDenial.status },
      );
    }

    const admin = createSupabaseAdminClient();

    const owned = await admin
      .from("tenants")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("scope", "user");
    if (owned.error) throw new RedactedDatabaseError(owned.error.code);

    for (const tenant of owned.data ?? []) {
      const removed = await admin.from("tenants").delete().eq("id", tenant.id);
      if (removed.error) throw new RedactedDatabaseError(removed.error.code);
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      // The provider message can carry account detail; only the shape of the
      // failure crosses the wire.
      return jsonResponse({ error: "account_deletion_failed" }, { status: 502 });
    }

    // Best effort: drop the now-orphaned session cookies so the browser is not
    // left holding a token for a user that no longer exists. The account is
    // already gone either way, so a failure here does not change the outcome.
    try {
      const client = await createSupabaseServerClient();
      await client.auth.signOut();
    } catch {
      // Nothing to clean up, or cookies are not writable in this context.
    }

    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return safeHttpError(error);
  }
}
