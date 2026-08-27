import { jsonResponse, safeHttpError } from "@/core/server/http";
import { findGuestSession, issueGuestSession } from "@/core/server/guest-sessions";
import { readIpSignalHash } from "@/core/server/request-signals";
import { sha256Hex } from "@/core/server/credentials";
import { readGuestSessionToken, writeGuestSessionCookie } from "@/core/server/session-cookies";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";

/**
 * Issues a server-side guest session backed by `guest_sessions`.
 *
 * The response never contains a tenant id, a raw token, or an address. The
 * cookie is HttpOnly, SameSite=Lax, and signed when a session secret exists.
 * Repeating the call with a live cookie returns the existing allowance instead
 * of minting a second session.
 */
export async function POST(request: Request) {
  try {
    if (!hasSupabaseSecretKey()) {
      return jsonResponse({ error: "guest_sessions_unavailable" }, { status: 503 });
    }

    const existingToken = await readGuestSessionToken();
    if (existingToken) {
      const existing = await findGuestSession(sha256Hex(existingToken));
      if (existing) {
        return jsonResponse({ guest: true, ...existing });
      }
    }

    const { token, summary } = await issueGuestSession({
      ipSignalHash: readIpSignalHash(request),
    });
    await writeGuestSessionCookie(token);
    return jsonResponse({ guest: true, ...summary }, { status: 201 });
  } catch (error) {
    return safeHttpError(error);
  }
}
