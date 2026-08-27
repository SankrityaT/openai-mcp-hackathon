import "server-only";

import { RedactedDatabaseError } from "@/core/server/database";
import { MemoryRefDatabaseError, SupabaseMemoryRefRepository } from "@/core/server/memory-ref-repository";
import { SupabaseMissionRepository } from "@/core/server/supabase-mission-repository";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemoryRefRepository } from "@/core/repositories/memory-repository";

/**
 * Authenticated, request-scoped context for the memory routes. Shares one
 * Supabase client between the mission repository (only used here to
 * resolve the caller's personal tenant) and the memory-ref repository, so a
 * request never opens more than one Supabase connection.
 */
export async function createAuthenticatedMemoryContext(): Promise<{
  memoryRepository: MemoryRefRepository;
  userId: string;
  tenantId: string;
}> {
  const client = await createSupabaseServerClient();
  const { userId } = await requireAuthenticatedUser(client);
  const missionRepository = new SupabaseMissionRepository(client);
  const tenant = await missionRepository.ensureUserTenant();
  return {
    memoryRepository: new SupabaseMemoryRefRepository(client),
    userId,
    tenantId: tenant.id,
  };
}

/**
 * `memory-ref-repository.ts` cannot import `RedactedDatabaseError` directly
 * (see its module comment) so it throws the parallel
 * `MemoryRefDatabaseError` instead. Route handlers run this translation
 * before calling `safeHttpError` so Postgres error codes still map to the
 * correct HTTP status.
 */
export function translateMemoryRefError(error: unknown): unknown {
  if (error instanceof MemoryRefDatabaseError) {
    return new RedactedDatabaseError(error.code);
  }
  return error;
}
