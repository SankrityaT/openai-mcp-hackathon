import { jsonResponse } from "@/core/server/http";
import { readGuestSessionToken, readJudgeCodeHash } from "@/core/server/session-cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Exposes only what a client needs to choose a data mode: whether persistence
 * is configured at all, whether this session is authenticated, and whether it
 * carries a server-issued guest or judge binding. No tenant id, token, hash, or
 * address is returned.
 */
export async function GET() {
  const [guestToken, judgeCodeHash] = await Promise.all([
    readGuestSessionToken(),
    readJudgeCodeHash(),
  ]);
  const guest = guestToken !== null;
  const judge = judgeCodeHash !== null;

  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getClaims();
    const userId = data?.claims?.sub;
    if (error || typeof userId !== "string") {
      return jsonResponse({ authenticated: false, configured: true, guest, judge });
    }
    return jsonResponse({ authenticated: true, configured: true, userId, guest, judge });
  } catch {
    // Persistence is not configured in this deployment. Say so instead of
    // implying an anonymous but otherwise live session.
    return jsonResponse({ authenticated: false, configured: false, guest, judge });
  }
}
