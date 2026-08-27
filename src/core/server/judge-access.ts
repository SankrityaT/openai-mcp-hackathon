import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hasSupabaseSecretKey } from "@/lib/supabase/secret-env";
import { DEFAULT_JUDGE_RUN_LIMIT } from "../policy/quota";
import { isSha256Hex } from "./credentials";
import { RedactedDatabaseError } from "./database";
import { getSessionSigningSecret } from "./session-cookies";

const UNIQUE_VIOLATION = "23505";

/**
 * The configured judge code hash. Only a hash is ever stored in configuration,
 * and the value is never returned to a client or written to a log.
 */
export function getConfiguredJudgeCodeHash(): string | null {
  const configured = process.env.CARDEA_JUDGE_CODE_HASH?.trim().toLowerCase();
  return isSha256Hex(configured) ? configured : null;
}

/**
 * Judge redemption needs a configured code hash, a cookie signing secret to
 * bind access to a session, and a server-only database credential. Missing any
 * of these disables the feature rather than degrading it.
 */
export function isJudgeRedemptionEnabled(): boolean {
  return (
    getConfiguredJudgeCodeHash() !== null &&
    getSessionSigningSecret() !== null &&
    hasSupabaseSecretKey()
  );
}

export type JudgeAllowance = { used: number; limit: number };

/**
 * Ensures a judge tenant and access row exist for the configured hash, then
 * returns the current allowance. Run reservation itself happens per mission
 * through `reserve_judge_run`, so redeeming a code never burns a run.
 */
export async function ensureJudgeAccess(codeHash: string): Promise<JudgeAllowance> {
  const client = createSupabaseAdminClient();
  const existing = await client
    .from("judge_access")
    .select("used_runs, max_runs, revoked_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (existing.error) throw new RedactedDatabaseError(existing.error.code);
  if (existing.data && existing.data.revoked_at === null) {
    return { used: existing.data.used_runs, limit: existing.data.max_runs };
  }
  if (existing.data) throw new RedactedDatabaseError("42501");

  const tenantResult = await client
    .from("tenants")
    .insert({ owner_user_id: null, scope: "judge", display_name: "Judge access" })
    .select("id")
    .single();
  if (tenantResult.error) throw new RedactedDatabaseError(tenantResult.error.code);

  const accessResult = await client
    .from("judge_access")
    .insert({
      tenant_id: tenantResult.data.id,
      code_hash: codeHash,
      max_runs: DEFAULT_JUDGE_RUN_LIMIT,
      used_runs: 0,
      expires_at: null,
    })
    .select("used_runs, max_runs")
    .single();

  if (accessResult.error) {
    await client.from("tenants").delete().eq("id", tenantResult.data.id);
    if (accessResult.error.code !== UNIQUE_VIOLATION) {
      throw new RedactedDatabaseError(accessResult.error.code);
    }
    const raced = await client
      .from("judge_access")
      .select("used_runs, max_runs")
      .eq("code_hash", codeHash)
      .single();
    if (raced.error) throw new RedactedDatabaseError(raced.error.code);
    return { used: raced.data.used_runs, limit: raced.data.max_runs };
  }

  return { used: accessResult.data.used_runs, limit: accessResult.data.max_runs };
}
