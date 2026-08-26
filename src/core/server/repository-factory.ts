import "server-only";

import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseMissionRepository } from "./supabase-mission-repository";

export async function createUserMissionRepository() {
  return new SupabaseMissionRepository(await createSupabaseServerClient());
}

export function createAdminMissionRepository() {
  return new SupabaseMissionRepository(createSupabaseAdminClient());
}
