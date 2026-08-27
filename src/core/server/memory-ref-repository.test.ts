import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MemoryRefRow } from "../database.types";
import { SupabaseMemoryRefRepository } from "./memory-ref-repository";

/**
 * Minimal in-memory fake matching only the `.from("memory_refs")` query
 * shapes SupabaseMemoryRefRepository issues: `insert().select().single()`,
 * `select().eq().eq()[.eq()].maybeSingle()`, and
 * `update().eq().eq().select().maybeSingle()`. It never touches a network
 * or database; this is a dependency-free unit test per the ticket's
 * "no live calls, no new dependencies" rule.
 */
function createFakeClient(seed: MemoryRefRow[] = []) {
  const rows: MemoryRefRow[] = [...seed];
  let counter = rows.length;

  function makeBuilder() {
    let filtered = rows;
    let pendingInsert: MemoryRefRow | null = null;
    let pendingUpdate: Partial<MemoryRefRow> | null = null;

    const builder = {
      insert(values: Record<string, unknown>) {
        counter += 1;
        const now = new Date().toISOString();
        const row = {
          id: `row-${counter}`,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          ...values,
        } as MemoryRefRow;
        rows.push(row);
        pendingInsert = row;
        filtered = [row];
        return builder;
      },
      update(patch: Record<string, unknown>) {
        pendingUpdate = patch as Partial<MemoryRefRow>;
        return builder;
      },
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filtered = filtered.filter((row) => (row as Record<string, unknown>)[column] === value);
        return builder;
      },
      async single() {
        if (pendingInsert) return { data: pendingInsert, error: null };
        const row = filtered[0];
        return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } };
      },
      async maybeSingle() {
        if (pendingUpdate) {
          const row = filtered[0];
          if (row) Object.assign(row, pendingUpdate, { updated_at: new Date().toISOString() });
          return { data: row ?? null, error: null };
        }
        return { data: filtered[0] ?? null, error: null };
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (table !== "memory_refs") throw new Error(`unexpected table ${table}`);
      return makeBuilder();
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, rows };
}

const tenantId = "tenant-1";

test("createMemoryRef persists an explicit-consent row and maps snake_case to camelCase", async () => {
  const { client } = createFakeClient();
  const repository = new SupabaseMemoryRefRepository(client);
  const record = await repository.createMemoryRef({
    tenantId,
    provider: "supermemory",
    externalRef: "mem-abc",
    version: 1,
    source: { source: "user note" },
    influence: "used to bias housing search",
    status: "promoted",
    promotedBy: "user-1",
  });
  assert.equal(record.tenantId, tenantId);
  assert.equal(record.externalRef, "mem-abc");
  assert.equal(record.status, "promoted");
  assert.equal(record.promotedBy, "user-1");
  assert.equal(record.deletedAt, null);
  assert.equal(record.missionId, null);
});

test("getMemoryRefByExternalRef supports idempotent-promote lookups and returns null when absent", async () => {
  const { client } = createFakeClient();
  const repository = new SupabaseMemoryRefRepository(client);
  assert.equal(
    await repository.getMemoryRefByExternalRef({ tenantId, provider: "supermemory", externalRef: "missing" }),
    null,
  );
  const created = await repository.createMemoryRef({
    tenantId,
    provider: "supermemory",
    externalRef: "mem-dup",
    version: 1,
    source: { source: "note" },
    influence: "influence",
    status: "promoted",
    promotedBy: "user-1",
  });
  const found = await repository.getMemoryRefByExternalRef({
    tenantId,
    provider: "supermemory",
    externalRef: "mem-dup",
  });
  assert.deepEqual(found, created);
});

test("getMemoryRefByExternalRef never crosses tenants", async () => {
  const { client } = createFakeClient([
    {
      id: "row-1",
      tenant_id: "tenant-a",
      mission_id: null,
      node_id: null,
      context_card_id: null,
      provider: "supermemory",
      external_ref: "mem-shared",
      version: 1,
      source: {},
      influence: "x",
      status: "promoted",
      promoted_by: "user-a",
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]);
  const repository = new SupabaseMemoryRefRepository(client);
  const crossTenant = await repository.getMemoryRefByExternalRef({
    tenantId: "tenant-b",
    provider: "supermemory",
    externalRef: "mem-shared",
  });
  assert.equal(crossTenant, null);
});

test("updateMemoryRef bumps version and edits influence/source without touching status", async () => {
  const { client } = createFakeClient();
  const repository = new SupabaseMemoryRefRepository(client);
  const created = await repository.createMemoryRef({
    tenantId,
    provider: "supermemory",
    externalRef: "mem-edit",
    version: 1,
    source: { source: "original" },
    influence: "original influence",
    status: "promoted",
    promotedBy: "user-1",
  });
  const updated = await repository.updateMemoryRef({
    id: created.id,
    tenantId,
    version: 2,
    influence: "revised influence",
    source: { source: "revised" },
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.influence, "revised influence");
  assert.deepEqual(updated.source, { source: "revised" });
  assert.equal(updated.status, "promoted");
});

test("markMemoryRefForgotten soft-deletes without erasing the audit row", async () => {
  const { client, rows } = createFakeClient();
  const repository = new SupabaseMemoryRefRepository(client);
  const created = await repository.createMemoryRef({
    tenantId,
    provider: "supermemory",
    externalRef: "mem-forget",
    version: 1,
    source: {},
    influence: "influence",
    status: "promoted",
    promotedBy: "user-1",
  });
  const forgotten = await repository.markMemoryRefForgotten({ id: created.id, tenantId });
  assert.equal(forgotten.status, "forgotten");
  assert.notEqual(forgotten.deletedAt, null);
  assert.equal(rows.length, 1, "the row must still exist for audit purposes");
  assert.equal(rows[0]?.id, created.id);
});
