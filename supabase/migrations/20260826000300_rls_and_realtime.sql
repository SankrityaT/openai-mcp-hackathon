begin;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.missions enable row level security;
alter table public.mission_mandates enable row level security;
alter table public.mission_nodes enable row level security;
alter table public.mission_edges enable row level security;
alter table public.mission_events enable row level security;
alter table public.mission_approvals enable row level security;
alter table public.mission_checkpoints enable row level security;
alter table public.capability_sources enable row level security;
alter table public.tool_runs enable row level security;
alter table public.context_cards enable row level security;
alter table public.memory_refs enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.guest_sessions enable row level security;
alter table public.judge_access enable row level security;
alter table public.security_events enable row level security;
alter table public.idempotency_records enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

grant usage on schema private to anon, authenticated;
grant execute on function private.can_read_tenant(uuid) to anon, authenticated;
grant execute on function private.can_write_tenant(uuid) to authenticated;

grant select on table
  public.tenants,
  public.tenant_memberships,
  public.missions,
  public.mission_mandates,
  public.mission_nodes,
  public.mission_edges,
  public.mission_events,
  public.mission_approvals,
  public.mission_checkpoints,
  public.capability_sources,
  public.tool_runs,
  public.context_cards,
  public.memory_refs,
  public.usage_ledger
to anon, authenticated;

grant select on table public.security_events to authenticated;
grant insert, update, delete on table
  public.context_cards,
  public.capability_sources,
  public.memory_refs
to authenticated;

create policy tenants_read_scope
on public.tenants for select to anon, authenticated
using (private.can_read_tenant(id));

create policy tenant_memberships_read_scope
on public.tenant_memberships for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy missions_read_scope
on public.missions for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_mandates_read_scope
on public.mission_mandates for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_nodes_read_scope
on public.mission_nodes for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_edges_read_scope
on public.mission_edges for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_events_read_scope
on public.mission_events for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_approvals_read_scope
on public.mission_approvals for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy mission_checkpoints_read_scope
on public.mission_checkpoints for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy capability_sources_read_scope
on public.capability_sources for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy tool_runs_read_scope
on public.tool_runs for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy context_cards_read_scope
on public.context_cards for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy memory_refs_read_scope
on public.memory_refs for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy usage_ledger_read_scope
on public.usage_ledger for select to anon, authenticated
using (private.can_read_tenant(tenant_id));

create policy security_events_read_scope
on public.security_events for select to authenticated
using (private.can_read_tenant(tenant_id));

create policy context_cards_insert_scope
on public.context_cards for insert to authenticated
with check (private.can_write_tenant(tenant_id));
create policy context_cards_update_scope
on public.context_cards for update to authenticated
using (private.can_write_tenant(tenant_id))
with check (private.can_write_tenant(tenant_id));
create policy context_cards_delete_scope
on public.context_cards for delete to authenticated
using (private.can_write_tenant(tenant_id));

create policy capability_sources_insert_scope
on public.capability_sources for insert to authenticated
with check (private.can_write_tenant(tenant_id));
create policy capability_sources_update_scope
on public.capability_sources for update to authenticated
using (private.can_write_tenant(tenant_id))
with check (private.can_write_tenant(tenant_id));
create policy capability_sources_delete_scope
on public.capability_sources for delete to authenticated
using (private.can_write_tenant(tenant_id));

create policy memory_refs_insert_scope
on public.memory_refs for insert to authenticated
with check (private.can_write_tenant(tenant_id));
create policy memory_refs_update_scope
on public.memory_refs for update to authenticated
using (private.can_write_tenant(tenant_id))
with check (private.can_write_tenant(tenant_id));
create policy memory_refs_delete_scope
on public.memory_refs for delete to authenticated
using (private.can_write_tenant(tenant_id));

grant execute on function public.ensure_user_tenant(text) to authenticated, service_role;
grant execute on function public.create_mission(uuid, text, text, jsonb, jsonb, uuid[], jsonb, text, text, uuid)
  to authenticated, service_role;
grant execute on function public.append_mission_event(uuid, bigint, text, text, text, uuid, jsonb, text, uuid, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.request_mission_approval(uuid, uuid, bigint, text, text, text, jsonb, jsonb, text, integer, timestamptz, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.resolve_mission_approval(uuid, text, jsonb, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.create_mission_checkpoint(uuid, uuid, bigint, text, jsonb, text, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.revert_mission_to_checkpoint(uuid, uuid, bigint, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.reserve_idempotency(uuid, text, text, text, timestamptz)
  to authenticated, service_role;
grant execute on function public.complete_idempotency(uuid, text, text, text, text, jsonb)
  to authenticated, service_role;
grant execute on function public.consume_usage(uuid, uuid, uuid, text, text, text, numeric, bigint, numeric, bigint, timestamptz, timestamptz, text, uuid)
  to authenticated, service_role;
grant execute on function public.record_security_event(uuid, uuid, text, text, text, text, text, text, jsonb, uuid)
  to authenticated, service_role;
grant execute on function public.reserve_guest_mission(text, text) to service_role;
grant execute on function public.reserve_judge_run(text) to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'mission_events'
    ) then
    execute 'alter publication supabase_realtime add table public.mission_events';
  end if;
end;
$$;

commit;
