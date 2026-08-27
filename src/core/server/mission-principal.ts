import "server-only";

import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MissionRepository } from "../repositories/mission-repository";
import { sha256Hex } from "./credentials";
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
