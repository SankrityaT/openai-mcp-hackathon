import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, MemoryRefRow } from "../database.types";
import type {
  CreateMemoryRefInput,
  MemoryConsentState,
  MemoryRefRecord,
  MemoryRefRepository,
  UpdateMemoryRefInput,
} from "../repositories/memory-repository";

/**
 * Mirrors `RedactedDatabaseError` from `./database` (same redaction shape:
 * a bare Postgres error code, never a raw message). This module
 * deliberately avoids importing `./database` or the `"server-only"` marker
 * so it stays runnable under plain `node:test` for unit tests; route
 * handlers (which only ever execute inside the Next.js server runtime) are
 * responsible for translating this into `RedactedDatabaseError` before
 * calling `safeHttpError`.
 */
export class MemoryRefDatabaseError extends Error {
  readonly code?: string;

  constructor(code?: string) {
    super("The requested memory reference operation could not be completed.");
    this.name = "MemoryRefDatabaseError";
    this.code = code;
  }
}

function fail(error: { code?: string } | null): never {
  throw new MemoryRefDatabaseError(error?.code);
}

function mapRow(row: MemoryRefRow): MemoryRefRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    contextCardId: row.context_card_id,
    provider: row.provider,
    externalRef: row.external_ref,
    version: row.version,
    source: row.source as MemoryRefRecord["source"],
    influence: row.influence,
    status: row.status as MemoryConsentState,
    promotedBy: row.promoted_by,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Direct authenticated PostgREST implementation of {@link MemoryRefRepository}.
 * `memory_refs` is scoped-CRUD per docs/CORE_DATA_POLICY.md (unlike mission
 * tables, which require RPC indirection), so this implementation issues
 * `.from("memory_refs")` calls under RLS with the request-scoped client.
 *
 * Every query is additionally filtered by `tenant_id` even though RLS also
 * enforces ownership, matching defense-in-depth conventions used elsewhere
 * in the codebase.
 */
export class SupabaseMemoryRefRepository implements MemoryRefRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createMemoryRef(input: CreateMemoryRefInput): Promise<MemoryRefRecord> {
    const result = await this.client
      .from("memory_refs")
      .insert({
        tenant_id: input.tenantId,
        mission_id: input.missionId ?? null,
        node_id: input.nodeId ?? null,
        context_card_id: input.contextCardId ?? null,
        provider: input.provider,
        external_ref: input.externalRef,
        version: input.version,
        source: input.source as Json,
        influence: input.influence,
        status: input.status,
        promoted_by: input.promotedBy,
      })
      .select("*")
      .single();
    if (result.error) fail(result.error);
    return mapRow(result.data);
  }

  async getMemoryRefById(input: { id: string; tenantId: string }): Promise<MemoryRefRecord | null> {
    const result = await this.client
      .from("memory_refs")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (result.error) fail(result.error);
    return result.data ? mapRow(result.data) : null;
  }

  async getMemoryRefByExternalRef(input: {
    tenantId: string;
    provider: string;
    externalRef: string;
  }): Promise<MemoryRefRecord | null> {
    const result = await this.client
      .from("memory_refs")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("provider", input.provider)
      .eq("external_ref", input.externalRef)
      .maybeSingle();
    if (result.error) fail(result.error);
    return result.data ? mapRow(result.data) : null;
  }

  async updateMemoryRef(input: UpdateMemoryRefInput): Promise<MemoryRefRecord> {
    const patch: Database["public"]["Tables"]["memory_refs"]["Update"] = {
      version: input.version,
      ...(input.source !== undefined ? { source: input.source as Json } : {}),
      ...(input.influence !== undefined ? { influence: input.influence } : {}),
    };
    const result = await this.client
      .from("memory_refs")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", input.tenantId)
      .select("*")
      .maybeSingle();
    if (result.error) fail(result.error);
    if (!result.data) fail(null);
    return mapRow(result.data);
  }

  async markMemoryRefForgotten(input: { id: string; tenantId: string }): Promise<MemoryRefRecord> {
    const result = await this.client
      .from("memory_refs")
      .update({ status: "forgotten", deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("tenant_id", input.tenantId)
      .select("*")
      .maybeSingle();
    if (result.error) fail(result.error);
    if (!result.data) fail(null);
    return mapRow(result.data);
  }
}
