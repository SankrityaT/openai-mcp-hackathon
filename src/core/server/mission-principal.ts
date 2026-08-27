import "server-only";

import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { MissionRepository } from "../repositories/mission-repository";
import { sha256Hex } from "./credentials";
import { RedactedDatabaseError } from "./database";
import { readGuestSessionToken, readJudgeCodeHash } from "./session-cookies";
import { SupabaseMissionRepository } from "./supabase-mission-repository";

/**
 * Who is asking. Identity is always a signed-in user, a server-issued guest
 * session, or a redeemed judge code. An IP address is never an identity.
 */
export type MissionPrincipal =
  | { kind: "user"; userId: string; repository: MissionRepository }
  | { kind: "judge"; codeHash: string }
  | { kind: "guest"; sessionTokenHash: string }
  | { kind: "anonymous" };

export async function resolveMissionPrincipal(): Promise<MissionPrincipal> {
  const client = await createSupabaseServerClient();
  try {
    const { userId } = await requireAuthenticatedUser(client);
    return { kind: "user", userId, repository: new SupabaseMissionRepository(client) };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
  }

  const codeHash = await readJudgeCodeHash();
  if (codeHash) return { kind: "judge", codeHash };

  const guestToken = await readGuestSessionToken();
  if (guestToken) return { kind: "guest", sessionTokenHash: sha256Hex(guestToken) };

  return { kind: "anonymous" };
}

/**
 * Tenant behind a guest or judge session, or null when the session is
 * unknown, revoked, or expired. Users resolve through RLS instead.
 */
async function resolvePrincipalTenantId(
  principal: Extract<MissionPrincipal, { kind: "guest" | "judge" }>,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  if (principal.kind === "judge") {
    const result = await admin
      .from("judge_access")
      .select("tenant_id, revoked_at")
      .eq("code_hash", principal.codeHash)
      .maybeSingle();
    if (result.error) throw new RedactedDatabaseError(result.error.code);
    const row = result.data;
    return row && row.revoked_at === null ? row.tenant_id : null;
  }
  const result = await admin
    .from("guest_sessions")
    .select("tenant_id, revoked_at, expires_at")
    .eq("session_token_hash", principal.sessionTokenHash)
    .maybeSingle();
  if (result.error) throw new RedactedDatabaseError(result.error.code);
  const row = result.data;
  if (!row || row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row.tenant_id;
}

/**
 * Read access to one mission for whoever is asking. Users read through their
 * RLS-scoped repository; guest and judge sessions read through the admin
 * repository only after the mission is confirmed to belong to their own
 * tenant; anonymous visitors get the RLS-scoped anon repository, which
 * exposes only public fixtures. Denied access resolves to null so tenants
 * cannot be probed apart from genuinely missing missions.
 */
export async function resolveMissionReadRepository(
  missionId: string,
): Promise<MissionRepository | null> {
  const principal = await resolveMissionPrincipal();
  if (principal.kind === "user") return principal.repository;
  if (principal.kind === "anonymous") {
    return new SupabaseMissionRepository(await createSupabaseServerClient());
  }
  const tenantId = await resolvePrincipalTenantId(principal);
  if (!tenantId) return null;
  const admin = new SupabaseMissionRepository(createSupabaseAdminClient());
  const snapshot = await admin.getMission(missionId);
  if (!snapshot || snapshot.mission.tenantId !== tenantId) return null;
  return admin;
}

export type MissionWriteContext = {
  repository: MissionRepository;
  actor: { kind: "user" | "system"; id: string };
  identityId: string;
};

/**
 * Resolves a write-capable repository without trusting a browser-supplied
 * tenant. Authenticated users write through RLS. Guest and judge sessions
 * write through the admin repository only after the mission is proven to
 * belong to the tenant bound to their HttpOnly session cookie.
 */
export async function resolveMissionWriteContext(
  missionId: string,
): Promise<MissionWriteContext | null> {
  const principal = await resolveMissionPrincipal();
  if (principal.kind === "anonymous") return null;
  if (principal.kind === "user") {
    const snapshot = await principal.repository.getMission(missionId);
    return snapshot
      ? {
          repository: principal.repository,
          actor: { kind: "user", id: principal.userId },
          identityId: principal.userId,
        }
      : null;
  }

  const tenantId = await resolvePrincipalTenantId(principal);
  if (!tenantId) return null;
  const repository = new SupabaseMissionRepository(createSupabaseAdminClient());
  const snapshot = await repository.getMission(missionId);
  if (!snapshot || snapshot.mission.tenantId !== tenantId) return null;
  return {
    repository,
    actor: { kind: "system", id: `${principal.kind}-session` },
    identityId: tenantId,
  };
}
