/**
 * The owner-scoped mission list behind the `/app` workspace strip.
 *
 * Like `standing-mission-records.ts` this avoids `server-only` and the route
 * plumbing so it stays a plain function of its client, and it takes the client
 * rather than resolving one: the caller has already decided whether this
 * request reads through the caller's own RLS session or through the admin
 * client narrowed to a guest or judge tenant. There is no code path here that
 * chooses that for itself, so this module can never widen a read.
 *
 * `updated_at desc` is genuine activity order rather than creation order: the
 * `missions_updated_at` before-update trigger and the event append RPCs both
 * touch the mission row, so the most recently worked mission sorts first.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionListItem } from "../contracts/mission-list";
import type { Database } from "../database.types";
import { RedactedDatabaseError } from "./database";

type Client = SupabaseClient<Database>;

/** Enough tabs to cover a working session without turning the strip into a list view. */
export const DEFAULT_MISSION_LIST_LIMIT = 20;

export type MissionListOptions = {
  /** Set for guest and judge sessions. Omitted for users, whose RLS already scopes the read. */
  tenantId?: string;
  limit?: number;
};

export async function listMissionSummaries(
  client: Client,
  options: MissionListOptions = {},
): Promise<MissionListItem[]> {
  const limit = options.limit ?? DEFAULT_MISSION_LIST_LIMIT;
  let query = client
    .from("missions")
    .select("id, title, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (options.tenantId) query = query.eq("tenant_id", options.tenantId);

  const result = await query;
  if (result.error) throw new RedactedDatabaseError(result.error.code);
  const rows = (result.data ?? []) as {
    id: string;
    title: string;
    status: string;
    updated_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at,
  }));
}
