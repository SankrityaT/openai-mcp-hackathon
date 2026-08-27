import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_GUEST_MISSION_LIMIT } from "../policy/quota";
import { createOpaqueToken, sha256Hex } from "./credentials";
import { RedactedDatabaseError } from "./database";
import { GUEST_SESSION_TTL_SECONDS } from "./session-cookies";

export type GuestSessionSummary = {
  missionLimit: number;
  missionsUsed: number;
  expiresAt: string;
};

/**
 * Guest sessions are server-issued and server-stored. The browser only ever
 * holds an opaque token in an HttpOnly cookie; the database only ever holds its
 * SHA-256 digest. No user identity is created or implied.
 */
export async function findGuestSession(
  sessionTokenHash: string,
): Promise<GuestSessionSummary | null> {
  const client = createSupabaseAdminClient();
  const result = await client
    .from("guest_sessions")
    .select("mission_limit, missions_created, expires_at, revoked_at")
    .eq("session_token_hash", sessionTokenHash)
    .maybeSingle();
  if (result.error) throw new RedactedDatabaseError(result.error.code);
  const row = result.data;
  if (!row || row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    missionLimit: row.mission_limit,
    missionsUsed: row.missions_created,
    expiresAt: row.expires_at,
  };
}

export async function issueGuestSession(input: {
  ipSignalHash?: string;
  missionLimit?: number;
}): Promise<{ token: string; summary: GuestSessionSummary }> {
  const client = createSupabaseAdminClient();
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000).toISOString();
  const missionLimit = input.missionLimit ?? DEFAULT_GUEST_MISSION_LIMIT;

  const tenantResult = await client
    .from("tenants")
    .insert({ owner_user_id: null, scope: "guest", display_name: "Guest session" })
    .select("id")
    .single();
  if (tenantResult.error) throw new RedactedDatabaseError(tenantResult.error.code);

  const sessionResult = await client
    .from("guest_sessions")
    .insert({
      tenant_id: tenantResult.data.id,
      session_token_hash: sha256Hex(token),
      ip_signal_hash: input.ipSignalHash ?? null,
      mission_limit: missionLimit,
      missions_created: 0,
      expires_at: expiresAt,
    })
    .select("mission_limit, missions_created, expires_at")
    .single();

  if (sessionResult.error) {
    await client.from("tenants").delete().eq("id", tenantResult.data.id);
    throw new RedactedDatabaseError(sessionResult.error.code);
  }

  return {
    token,
    summary: {
      missionLimit: sessionResult.data.mission_limit,
      missionsUsed: sessionResult.data.missions_created,
      expiresAt: sessionResult.data.expires_at,
    },
  };
}
