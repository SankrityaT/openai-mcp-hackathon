import { jsonResponse, safeHttpError } from "@/core/server/http";
import {
  disableEmailChannel,
  enableEmailChannel,
  readEmailChannel,
} from "@/core/server/notification-channels";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The caller's own reach-me preference: whether Cardea may email them when a
 * mission stops for their judgment.
 *
 * `requireAuthenticatedUser` is the only door, exactly as in the Composio
 * connection routes. A judge code and a guest session carry no Supabase
 * session and no email address, so both fall through to a 401 like an
 * anonymous visitor. That is intended: there is no account to reach.
 *
 * No request body is read on any verb. The preference is a single bit, the
 * subject is always the caller, and the destination is always the account's
 * own sign-in address — so there is nothing a client could send that would
 * change where a notification goes.
 */

async function requireSession() {
  const client = await createSupabaseServerClient();
  const { userId } = await requireAuthenticatedUser(client);
  return { client, userId };
}

/** GET /api/notifications/email — the caller's own status. */
export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit("notifications", readIpSignalHash(request));
    if (limited) return limited;

    const { client, userId } = await requireSession();
    const channel = await readEmailChannel(client, userId);
    return jsonResponse({ enabled: channel?.enabled === true });
  } catch (error) {
    return safeHttpError(error);
  }
}

/** POST /api/notifications/email — turn it on. Idempotent. */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("notifications", readIpSignalHash(request));
    if (limited) return limited;

    const { client, userId } = await requireSession();
    const ok = await enableEmailChannel(client, userId);
    if (!ok) return jsonResponse({ error: "not_available" }, { status: 503 });
    return jsonResponse({ enabled: true });
  } catch (error) {
    return safeHttpError(error);
  }
}

/**
 * DELETE /api/notifications/email — turn it off.
 *
 * The row is disabled rather than removed, so turning it back on is one write
 * and the original opt-in date survives.
 */
export async function DELETE(request: Request) {
  try {
    const limited = enforceRateLimit("notifications", readIpSignalHash(request));
    if (limited) return limited;

    const { client, userId } = await requireSession();
    const ok = await disableEmailChannel(client, userId);
    if (!ok) return jsonResponse({ error: "not_available" }, { status: 503 });
    return jsonResponse({ enabled: false });
  } catch (error) {
    return safeHttpError(error);
  }
}
