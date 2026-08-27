/**
 * Pure decision helpers for account erasure.
 *
 * Deleting an account is irreversible and cascades through every mission,
 * event, checkpoint, and usage row the account's tenants own, so the two
 * decisions that gate it are kept here as pure functions of their arguments:
 * who is allowed to ask, and what the request body has to say. Neither reads
 * cookies, environment, or the network, so both are unit-testable under
 * `node --test` the same way `rate-limit.ts` and `credentials.ts` are. The
 * route in `src/app/api/account/route.ts` owns everything with a side effect.
 */

/**
 * The exact phrase a caller must send. Typed in full, in the body, so a
 * stray fetch, a replayed link, or a CSRF-shaped request cannot erase an
 * account by accident. Compared byte for byte: no trimming, no case folding.
 */
export const ACCOUNT_DELETION_CONFIRMATION = "delete my account";

/** Principal kinds as resolved by `resolveMissionPrincipal`. */
export type AccountDeletionPrincipalKind = "user" | "judge" | "guest" | "anonymous";

export type AccountDeletionDenial = {
  /** Stable machine-readable code for the JSON error body. */
  error: string;
  /** Honest, non-leaking explanation of why the request cannot proceed. */
  reason: string;
  status: number;
};

/**
 * Whether this principal owns an account that can be deleted.
 *
 * Only a signed-in Supabase user does. A guest session and a judge code are
 * server-issued, shared, tenant-scoped grants with no `auth.users` row behind
 * them, and an anonymous visitor has no identity at all. All three get 401
 * with a reason that says plainly there is no account on this session, rather
 * than a vague "forbidden" that implies one exists.
 */
export function denyAccountDeletionPrincipal(
  kind: AccountDeletionPrincipalKind,
): AccountDeletionDenial | null {
  if (kind === "user") return null;
  return {
    error: "authentication_required",
    reason:
      kind === "anonymous"
        ? "Sign in to delete an account. This request carries no session."
        : `A ${kind} session has no Cardea account to delete. Sign in with the account you want removed.`,
    status: 401,
  };
}

/**
 * Whether the parsed request body carries the exact confirmation phrase.
 *
 * `body` is whatever `request.json()` produced, or the sentinel the route
 * passes when the payload was not JSON at all. Anything other than an object
 * whose `confirm` is exactly {@link ACCOUNT_DELETION_CONFIRMATION} is a 400.
 */
export function denyAccountDeletionConfirmation(body: unknown): AccountDeletionDenial | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: "invalid_request",
      reason: `Send a JSON body of {"confirm":"${ACCOUNT_DELETION_CONFIRMATION}"} to confirm.`,
      status: 400,
    };
  }
  const confirm = (body as Record<string, unknown>).confirm;
  if (confirm !== ACCOUNT_DELETION_CONFIRMATION) {
    return {
      error: "confirmation_required",
      reason: `Set "confirm" to exactly "${ACCOUNT_DELETION_CONFIRMATION}" to delete this account.`,
      status: 400,
    };
  }
  return null;
}
