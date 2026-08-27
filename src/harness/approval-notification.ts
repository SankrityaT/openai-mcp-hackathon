// Note: no `import "server-only"` here — see planner.ts for why. Only
// invoked from the `cardea-notify-approval` Inngest function, a server-only
// execution context. Relative (not `@/...`-aliased) value imports below are
// deliberate for the same reason they are in execute-node.ts: the `paths`
// alias is compile-time only and is never rewritten in emitted JS.
import {
  composeApprovalEmail,
  type ApprovalEmailFailureReason,
  type ApprovalEmailResult,
} from "../core/server/approval-email";

/**
 * Reach-me approvals: the decision procedure for "a mission stopped, who
 * should hear about it, and what should they be told".
 *
 * Every side effect is injected, so this reads as a plain function of its
 * inputs: resolve the mission's owner, resolve their address, check they
 * asked to be reached, compose the message from the approval's own content,
 * send. Each miss is a named, quiet outcome rather than an error, because a
 * mission that cannot be announced is still a mission that paused correctly.
 *
 * Guest and judge tenants have no owner at all. They exit at the first step,
 * which is the common case for a hackathon demo run and must stay silent.
 */

export type ApprovalNotificationInput = {
  approvalId: string;
  missionId: string;
  tenantId: string;
  recommendation: string;
  consequence: string;
  category: string;
  codename: string;
};

export type ApprovalNotificationDeps = {
  /** The tenant's `owner_user_id`, or null for guest, judge, and system tenants. */
  resolveOwnerUserId: (tenantId: string) => Promise<string | null>;
  /** True only when the owner has turned reach-me email on. */
  isEmailChannelEnabled: (userId: string) => Promise<boolean>;
  /** The account's own sign-in address, read at send time. Never stored by Cardea. */
  resolveOwnerEmail: (userId: string) => Promise<string | null>;
  send: (to: string, content: { subject: string; text: string }) => Promise<ApprovalEmailResult>;
  /** Absolute origin of this deployment, used to build the board link. */
  appOrigin: string;
};

export type ApprovalNotificationOutcome =
  | { status: "sent" }
  | { status: "no_owner" }
  | { status: "channel_disabled" }
  | { status: "no_address" }
  | { status: "not_sent"; reason: ApprovalEmailFailureReason };

/**
 * The board link for the email. An email cannot follow a relative path, so an
 * unset or non-absolute `CARDEA_APP_ORIGIN` yields no link at all rather than
 * a broken one; the decision and its consequence still arrive.
 */
export function approvalBoardUrl(appOrigin: string): string {
  if (typeof appOrigin !== "string" || !/^https?:\/\//.test(appOrigin)) return "";
  return `${appOrigin.replace(/\/+$/, "")}/app`;
}

export async function notifyApprovalRequested(
  input: ApprovalNotificationInput,
  deps: ApprovalNotificationDeps,
): Promise<ApprovalNotificationOutcome> {
  const ownerUserId = await deps.resolveOwnerUserId(input.tenantId);
  if (!ownerUserId) return { status: "no_owner" };

  if (!(await deps.isEmailChannelEnabled(ownerUserId))) return { status: "channel_disabled" };

  const to = await deps.resolveOwnerEmail(ownerUserId);
  if (!to) return { status: "no_address" };

  const content = composeApprovalEmail({
    recommendation: input.recommendation,
    consequence: input.consequence,
    codename: input.codename,
    boardUrl: approvalBoardUrl(deps.appOrigin),
  });

  const result = await deps.send(to, content);
  return result.sent ? { status: "sent" } : { status: "not_sent", reason: result.reason };
}
