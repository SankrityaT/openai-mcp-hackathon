import "server-only";

import {
  resolveStandingMissionOwner,
  type StandingMissionPrincipal,
} from "@/core/contracts/standing-missions";
import { RedactedDatabaseError } from "@/core/server/database";
import { readGuestSessionToken, readJudgeCodeHash } from "@/core/server/session-cookies";
import { StandingMissionDatabaseError } from "@/core/server/standing-mission-records";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/core/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is asking, in the vocabulary `resolveStandingMissionOwner` decides on.
 *
 * Guest and judge sessions are named rather than folded into "anonymous" so
 * the refusal is a deliberate product rule with a tested shape, not an
 * accident of which cookie happened to be missing.
 */
async function resolveStandingPrincipal(
  client: SupabaseClient<Database>,
): Promise<StandingMissionPrincipal> {
  try {
    const { userId } = await requireAuthenticatedUser(client);
    return { kind: "user", userId };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
  }
  if (await readJudgeCodeHash()) return { kind: "judge" };
  if (await readGuestSessionToken()) return { kind: "guest" };
  return { kind: "anonymous" };
}

/**
 * Authenticated, request-scoped context for the standing-mission routes. One
 * Supabase client per request, RLS-scoped to the caller, so every read and
 * every owner-side write is bounded by `user_id = auth.uid()` in the database
 * as well as by the explicit filters in `standing-mission-records.ts`.
 */
export async function createStandingMissionContext(): Promise<{
  client: SupabaseClient<Database>;
  userId: string;
}> {
  const client = await createSupabaseServerClient();
  const owner = resolveStandingMissionOwner(await resolveStandingPrincipal(client));
  if (!owner.ok) throw new AuthenticationRequiredError();
  return { client, userId: owner.userId };
}

/**
 * `standing-mission-records.ts` cannot import `RedactedDatabaseError` directly
 * (see its module comment), so it throws the parallel
 * `StandingMissionDatabaseError`. Route handlers run this translation before
 * calling `safeHttpError` so Postgres error codes still map to the right
 * HTTP status.
 */
export function translateStandingMissionError(error: unknown): unknown {
  if (error instanceof StandingMissionDatabaseError) {
    return new RedactedDatabaseError(error.code);
  }
  return error;
}
