import "server-only";

import type { MissionRepository } from "../repositories/mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseMissionRepository } from "./supabase-mission-repository";

export async function createUserMissionRepository(): Promise<MissionRepository> {
  return new SupabaseMissionRepository(await createSupabaseServerClient());
}

export async function createAuthenticatedMissionRepository(): Promise<{
  repository: MissionRepository;
  userId: string;
}> {
  const client = await createSupabaseServerClient();
  const { userId } = await requireAuthenticatedUser(client);
  return { repository: new SupabaseMissionRepository(client), userId };
}

export function createAdminMissionRepository(): MissionRepository {
  return new SupabaseMissionRepository(createSupabaseAdminClient());
}
