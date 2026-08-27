/**
 * First-login tenant provisioning must be idempotent.
 *
 * Cardea provisions a personal tenant lazily: every authenticated entry point
 * (missions, memory, and now the Composio connections flow) calls
 * `ensureUserTenant()` rather than hooking a one-time signup event. That only
 * works if a second call is free, so this file pins both halves of that
 * guarantee:
 *
 *  1. the contract, against an in-memory double that models the RPC's
 *     insert-if-absent semantics, and
 *  2. the SQL itself, by asserting the shipped migration still declares the
 *     partial unique conflict target that makes the insert a no-op. Without
 *     this second check the double would be free to drift into testing only
 *     itself.
 *
 * `SupabaseMissionRepository` cannot be imported here: it begins with
 * `import "server-only"`, which Next.js aliases at build time and plain
 * `node --test` cannot resolve. What it adds over the double is a single
 * `rpc("ensure_user_tenant")` call, which is exactly the delegation the
 * double stands in for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Tenant } from "../contracts/types";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260826000200_transactions_and_guards.sql",
);

/**
 * In-memory stand-in for `public.ensure_user_tenant`, written to mirror the
 * migration line for line: insert a `scope = 'user'` tenant for `auth.uid()`,
 * do nothing when one already exists, then return the row either way.
 */
function createTenantStore(userId: string) {
  const rows: Tenant[] = [];
  let calls = 0;
  return {
    get rows() {
      return rows;
    },
    get calls() {
      return calls;
    },
    ensureUserTenant(displayName = "Personal"): Tenant {
      calls += 1;
      const existing = rows.find((row) => row.ownerUserId === userId && row.scope === "user");
      if (existing) return existing;
      const created: Tenant = {
        id: `tenant-${rows.length + 1}`,
        ownerUserId: userId,
        scope: "user",
        displayName,
        createdAt: new Date(0).toISOString(),
      };
      rows.push(created);
      return created;
    },
  };
}

test("first authenticated use provisions exactly one personal tenant", () => {
  const store = createTenantStore("11111111-1111-4111-8111-111111111111");
  const tenant = store.ensureUserTenant();

  assert.equal(store.rows.length, 1);
  assert.equal(tenant.scope, "user");
  assert.equal(tenant.ownerUserId, "11111111-1111-4111-8111-111111111111");
});

test("a second ensureUserTenant call adds no rows and returns the same tenant", () => {
  const store = createTenantStore("11111111-1111-4111-8111-111111111111");
  const first = store.ensureUserTenant();
  const second = store.ensureUserTenant();

  assert.equal(store.calls, 2, "the caller always delegates rather than caching a decision");
  assert.equal(store.rows.length, 1, "a repeat call must not create a second tenant");
  assert.equal(second.id, first.id);
});

test("two different users each get their own personal tenant", () => {
  const alice = createTenantStore("11111111-1111-4111-8111-111111111111");
  const bob = createTenantStore("22222222-2222-4222-8222-222222222222");
  alice.ensureUserTenant();
  alice.ensureUserTenant();
  bob.ensureUserTenant();

  assert.equal(alice.rows.length, 1);
  assert.equal(bob.rows.length, 1);
  assert.notEqual(alice.rows[0].ownerUserId, bob.rows[0].ownerUserId);
});

test("the shipped ensure_user_tenant migration still swallows the duplicate insert", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const body = sql.slice(sql.indexOf("function public.ensure_user_tenant"));

  assert.ok(
    body.includes("on conflict (owner_user_id) where scope = 'user' do nothing"),
    "removing the conflict target would make a second first-login call raise instead of no-op",
  );
});
