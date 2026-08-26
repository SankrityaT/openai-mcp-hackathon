begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'owner-a@example.test', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'owner-b@example.test', '{}', '{}');

insert into public.tenants(id, owner_user_id, scope, display_name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'user', 'Owner A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'user', 'Owner B'),
  ('20000000-0000-4000-8000-000000000003', null, 'public_fixture', 'Immutable demo'),
  ('20000000-0000-4000-8000-000000000004', null, 'guest', 'Guest'),
  ('20000000-0000-4000-8000-000000000005', null, 'judge', 'Judge');

insert into public.tenant_memberships(tenant_id, user_id, role)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

insert into public.missions(id, tenant_id, title)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner A mission'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Owner B mission'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'Public fixture mission');

insert into public.guest_sessions(
  tenant_id, session_token_hash, mission_limit, expires_at
) values (
  '20000000-0000-4000-8000-000000000004', repeat('a', 64), 1, now() + interval '1 hour'
);

insert into public.judge_access(tenant_id, code_hash)
values ('20000000-0000-4000-8000-000000000005', repeat('b', 64));

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select title from public.missions order by title $$,
  $$ values ('Owner A mission'::text), ('Public fixture mission'::text) $$,
  'Owner A reads its own and public fixture missions'
);

select is_empty(
  $$ select id from public.missions where id = '30000000-0000-4000-8000-000000000002' $$,
  'Owner A cannot read Owner B mission'
);

select throws_ok(
  $$ insert into public.missions(tenant_id, title) values ('20000000-0000-4000-8000-000000000001', 'Direct write') $$,
  '42501',
  null,
  'Direct mission writes are denied'
);

select is(
  (
    select sequence from public.append_mission_event(
      '30000000-0000-4000-8000-000000000001', 0, 'mission.cancelled', 'user',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', '{}'::jsonb, 'trusted',
      null, 'append-event-00000001', 'cancelled', null, null
    )
  ),
  1::bigint,
  'Event append reserves the next mission sequence'
);

select results_eq(
  $$
    select last_event_sequence, state_version, status
    from public.missions where id = '30000000-0000-4000-8000-000000000001'
  $$,
  $$ values (1::bigint, 1::bigint, 'cancelled'::text) $$,
  'Event append and mission materialization commit atomically'
);

select throws_ok(
  $$
    select public.append_mission_event(
      '30000000-0000-4000-8000-000000000001', 0, 'mission.cancelled', 'user',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002', '{}'::jsonb, 'trusted',
      null, 'append-event-00000002', 'cancelled', null, null
    )
  $$,
  '40001',
  'Mission sequence conflict',
  'Stale event writers are rejected'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (
    select status from public.request_mission_approval(
      '30000000-0000-4000-8000-000000000001', null, 1, 'external_write',
      'approval-fingerprint-0000000000000001', 'Approve exact write', '[]'::jsonb,
      '[]'::jsonb, 'An external record changes', 1, now() + interval '1 hour',
      'system', 'policy-engine',
      '40000000-0000-4000-8000-000000000003', 'approval-request-00000001'
    )
  ),
  'pending'::text,
  'Approval request creates pending materialized state'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select status from public.resolve_mission_approval(
      (select id from public.mission_approvals where mission_id = '30000000-0000-4000-8000-000000000001'),
      'accepted', '{"decision":"accepted"}'::jsonb, 'user',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004', 'approval-resolve-00000001'
    )
  ),
  'resolved'::text,
  'Approval resolution settles the pending row'
);

select is(
  (
    select status from public.resolve_mission_approval(
      (select id from public.mission_approvals where mission_id = '30000000-0000-4000-8000-000000000001'),
      'accepted', '{"decision":"accepted"}'::jsonb, 'user',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004', 'approval-resolve-00000001'
    )
  ),
  'resolved'::text,
  'An identical approval retry returns the original settlement'
);

select is(
  (
    select count(*)::integer from public.mission_events
    where idempotency_key = 'approval-resolve-00000001'
  ),
  1,
  'Approval retry does not append a second resolution event'
);

select throws_ok(
  $$
    select public.resolve_mission_approval(
      (select id from public.mission_approvals where mission_id = '30000000-0000-4000-8000-000000000001'),
      'rejected', '{"decision":"rejected"}'::jsonb, 'user',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000005', 'approval-resolve-00000002'
    )
  $$,
  '23505',
  'Approval has already been settled',
  'A conflicting approval double-submit is rejected'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (public.consume_usage(
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    null, 'mission', '30000000-0000-4000-8000-000000000001', 'mission_run',
    1, 10, 1, 100, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z',
    'usage-debit-0000000001', '40000000-0000-4000-8000-000000000006'
  )->>'totalQuantity')::numeric,
  1::numeric,
  'Usage debit succeeds inside quota and budget'
);

select is(
  (public.consume_usage(
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    null, 'mission', '30000000-0000-4000-8000-000000000001', 'mission_run',
    1, 10, 1, 100, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z',
    'usage-debit-0000000001', '40000000-0000-4000-8000-000000000006'
  )->>'totalQuantity')::numeric,
  1::numeric,
  'Usage retry is idempotent'
);

select throws_ok(
  $$
    select public.consume_usage(
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
      null, 'mission', '30000000-0000-4000-8000-000000000001', 'mission_run',
      1, 10, 1, 100, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z',
      'usage-debit-0000000002', '40000000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'Quota exhausted',
  'Quota is enforced atomically on the server'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  $$ select title from public.missions $$,
  $$ values ('Public fixture mission'::text) $$,
  'Anonymous access is restricted to public fixture scope'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (public.reserve_guest_mission(repeat('a', 64))->>'limit')::integer,
  1,
  'Guest quota defaults to one mission'
);

select throws_ok(
  $$ select public.reserve_guest_mission(repeat('a', 64)) $$,
  'P0001',
  'Guest mission quota exhausted or session invalid',
  'Guest mission quota cannot be consumed twice'
);

select is(
  (
    select (public.reserve_judge_run(repeat('b', 64))->>'used')::integer
    from generate_series(1, 10)
    order by 1 desc limit 1
  ),
  10,
  'Judge code permits up to ten runs'
);

select * from finish();
rollback;
