begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_table('public', 'missions', 'missions exists');
select has_table('public', 'mission_mandates', 'mission_mandates exists');
select has_table('public', 'mission_nodes', 'mission_nodes exists');
select has_table('public', 'mission_edges', 'mission_edges exists');
select has_table('public', 'mission_events', 'mission_events exists');
select has_table('public', 'mission_approvals', 'mission_approvals exists');
select has_table('public', 'mission_checkpoints', 'mission_checkpoints exists');
select has_table('public', 'capability_sources', 'capability_sources exists');
select has_table('public', 'tool_runs', 'tool_runs exists');
select has_table('public', 'context_cards', 'context_cards exists');
select has_table('public', 'memory_refs', 'memory_refs exists');
select has_table('public', 'usage_ledger', 'usage_ledger exists');
select has_table('public', 'guest_sessions', 'guest_sessions exists');
select has_table('public', 'judge_access', 'judge_access exists');
select has_table('public', 'security_events', 'security_events exists');

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'tenants', 'tenant_memberships', 'missions', 'mission_mandates',
        'mission_nodes', 'mission_edges', 'mission_events', 'mission_approvals',
        'mission_checkpoints', 'capability_sources', 'tool_runs', 'context_cards',
        'memory_refs', 'usage_ledger', 'guest_sessions', 'judge_access',
        'security_events', 'idempotency_records'
      )
      and c.relrowsecurity
  $$,
  array[18::bigint],
  'RLS is enabled on every application table'
);

select trigger_is(
  'public', 'mission_events', 'mission_events_append_only',
  'private', 'reject_mutation',
  'mission_events rejects update and delete'
);

select trigger_is(
  'public', 'usage_ledger', 'usage_ledger_append_only',
  'private', 'reject_mutation',
  'usage_ledger rejects update and delete'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'request_mission_approval', 'create_mission_checkpoint',
        'reserve_idempotency', 'complete_idempotency', 'consume_usage',
        'record_security_event'
      )
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  array[0::bigint],
  'Internal side-effect functions are not executable by authenticated clients'
);

select * from finish();
rollback;
