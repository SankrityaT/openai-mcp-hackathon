begin;

-- Cascade erasure: let account and tenant deletion reach append-only tables.
--
-- `private.reject_mutation()` guards the append-only tables (`mission_events`,
-- `mission_checkpoints`, `usage_ledger`, `security_events`). Until now it
-- rejected every UPDATE and every DELETE, which also rejected the DELETEs that
-- PostgreSQL's referential-integrity machinery issues on behalf of
-- `on delete cascade`. That made erasure impossible: deleting a tenant, and
-- therefore deleting an `auth.users` row, failed with 55000
-- ("usage_ledger is append-only"), and `DELETE /auth/v1/admin/users/{id}`
-- returned 500.
--
-- The distinguishing signal is `pg_trigger_depth()`. A statement a client
-- issues directly runs this BEFORE trigger at depth 1. A DELETE produced by
-- an FK cascade is issued from inside PostgreSQL's internal RI AFTER trigger
-- on the parent table, so this BEFORE trigger runs nested, at depth 2 or
-- deeper (deeper still for multi-hop chains such as
-- tenants -> missions -> mission_events). Measured against this database
-- before applying this migration:
--
--   direct DELETE on public.usage_ledger        -> tg_op=DELETE depth=1
--   direct UPDATE on public.usage_ledger        -> tg_op=UPDATE depth=1
--   DELETE public.tenants (cascades to ledger)  -> tg_op=DELETE depth=2
--
-- So append-only still holds for every write a client or an RPC can make on
-- its own: a direct DELETE is still rejected with 55000 and the same message,
-- and UPDATE stays rejected unconditionally at any depth, because history is
-- never rewritten in place. The only DELETE that now passes is one the
-- database itself issues while tearing down a parent row, which is exactly
-- the account/tenant erasure path (right to erasure) and nothing else.
--
-- Note that `public.tenants.owner_user_id` is `on delete restrict`, so
-- deleting an `auth.users` row does not by itself remove that user's tenant.
-- Owned tenants must be deleted first, and then the auth user; this migration
-- is what makes that first step possible.

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nested depth means this DELETE came from the referential-integrity
  -- cascade of a parent row's deletion, not from a client statement.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

comment on function private.reject_mutation() is
  'Append-only guard. Rejects UPDATE always and rejects DELETE issued directly by a client (pg_trigger_depth() = 1) with errcode 55000. Permits DELETE arriving through a foreign-key cascade (nested trigger depth) so account and tenant erasure can complete.';

commit;
