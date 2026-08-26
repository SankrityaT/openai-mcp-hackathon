begin;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create or replace function private.reject_public_fixture_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := old.tenant_id;
  if exists (
    select 1 from public.tenants
    where id = v_tenant_id and scope = 'public_fixture'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Public fixture rows are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.reject_public_fixture_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.scope = 'public_fixture' then
    raise exception using errcode = '55000', message = 'Public fixture tenants are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.can_read_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and (
        t.scope = 'public_fixture'
        or (auth.uid() is not null and t.owner_user_id = auth.uid())
        or exists (
          select 1 from public.tenant_memberships tm
          where tm.tenant_id = t.id and tm.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function private.can_write_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.scope = 'user'
      and auth.uid() is not null
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.tenant_memberships tm
          where tm.tenant_id = t.id
            and tm.user_id = auth.uid()
            and tm.role in ('owner', 'member', 'operator')
        )
      )
  );
$$;

create or replace function private.assert_actor(p_actor_kind text, p_actor_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_kind not in ('user', 'cardea', 'tool', 'system') then
    raise exception using errcode = '22023', message = 'Invalid actor kind';
  end if;
  if char_length(p_actor_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Invalid actor id';
  end if;
  if auth.role() <> 'service_role'
    and (
      auth.uid() is null
      or p_actor_kind <> 'user'
      or p_actor_id <> auth.uid()::text
    ) then
    raise exception using errcode = '42501', message = 'Actor does not match the authenticated user';
  end if;
end;
$$;

create trigger tenants_public_fixture_immutable
before update or delete on public.tenants
for each row execute function private.reject_public_fixture_tenant_change();

create trigger context_cards_updated_at before update on public.context_cards
for each row execute function private.set_updated_at();
create trigger missions_updated_at before update on public.missions
for each row execute function private.set_updated_at();
create trigger mission_nodes_updated_at before update on public.mission_nodes
for each row execute function private.set_updated_at();
create trigger mission_approvals_updated_at before update on public.mission_approvals
for each row execute function private.set_updated_at();
create trigger capability_sources_updated_at before update on public.capability_sources
for each row execute function private.set_updated_at();
create trigger tool_runs_updated_at before update on public.tool_runs
for each row execute function private.set_updated_at();
create trigger memory_refs_updated_at before update on public.memory_refs
for each row execute function private.set_updated_at();
create trigger guest_sessions_updated_at before update on public.guest_sessions
for each row execute function private.set_updated_at();
create trigger judge_access_updated_at before update on public.judge_access
for each row execute function private.set_updated_at();
create trigger idempotency_records_updated_at before update on public.idempotency_records
for each row execute function private.set_updated_at();

create trigger mission_events_append_only before update or delete on public.mission_events
for each row execute function private.reject_mutation();
create trigger mission_checkpoints_append_only before update or delete on public.mission_checkpoints
for each row execute function private.reject_mutation();
create trigger usage_ledger_append_only before update or delete on public.usage_ledger
for each row execute function private.reject_mutation();
create trigger security_events_append_only before update or delete on public.security_events
for each row execute function private.reject_mutation();

create trigger missions_public_fixture_immutable before update or delete on public.missions
for each row execute function private.reject_public_fixture_change();
create trigger mandates_public_fixture_immutable before update or delete on public.mission_mandates
for each row execute function private.reject_public_fixture_change();
create trigger nodes_public_fixture_immutable before update or delete on public.mission_nodes
for each row execute function private.reject_public_fixture_change();
create trigger edges_public_fixture_immutable before update or delete on public.mission_edges
for each row execute function private.reject_public_fixture_change();
create trigger approvals_public_fixture_immutable before update or delete on public.mission_approvals
for each row execute function private.reject_public_fixture_change();
create trigger capability_sources_public_fixture_immutable before update or delete on public.capability_sources
for each row execute function private.reject_public_fixture_change();
create trigger context_cards_public_fixture_immutable before update or delete on public.context_cards
for each row execute function private.reject_public_fixture_change();
create trigger memory_refs_public_fixture_immutable before update or delete on public.memory_refs
for each row execute function private.reject_public_fixture_change();

create or replace function public.ensure_user_tenant(p_display_name text default 'Personal')
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant public.tenants;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if char_length(p_display_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Display name is out of bounds';
  end if;

  insert into public.tenants(owner_user_id, scope, display_name)
  values (v_user_id, 'user', p_display_name)
  on conflict (owner_user_id) where scope = 'user' do nothing;

  select * into strict v_tenant
  from public.tenants
  where owner_user_id = v_user_id and scope = 'user';

  insert into public.tenant_memberships(tenant_id, user_id, role)
  values (v_tenant.id, v_user_id, 'owner')
  on conflict (tenant_id, user_id) do nothing;

  return v_tenant;
end;
$$;

create or replace function public.create_mission(
  p_tenant_id uuid,
  p_title text,
  p_goal text,
  p_constraints jsonb,
  p_authority jsonb,
  p_selected_context_card_ids uuid[],
  p_budget_limits jsonb,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid
)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_event_id uuid := gen_random_uuid();
begin
  if not private.can_write_tenant(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Tenant access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);
  if char_length(p_title) not between 1 and 200 or char_length(p_goal) not between 1 and 8000 then
    raise exception using errcode = '22023', message = 'Mission input is out of bounds';
  end if;
  if jsonb_typeof(p_constraints) <> 'array'
    or jsonb_typeof(p_authority) <> 'object'
    or jsonb_typeof(p_budget_limits) <> 'object' then
    raise exception using errcode = '22023', message = 'Mission JSON input has an invalid shape';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_selected_context_card_ids, '{}')) card_id
    where not exists (
      select 1 from public.context_cards
      where tenant_id = p_tenant_id and id = card_id
    )
  ) then
    raise exception using errcode = '23503', message = 'Context card is outside the tenant';
  end if;

  insert into public.missions(tenant_id, title, budget_limits)
  values (p_tenant_id, p_title, p_budget_limits)
  returning * into v_mission;

  insert into public.mission_mandates(
    tenant_id, mission_id, version, goal, constraints, authority,
    selected_context_card_ids, created_by_kind, created_by_id
  ) values (
    p_tenant_id, v_mission.id, 1, p_goal, p_constraints, p_authority,
    coalesce(p_selected_context_card_ids, '{}'), p_actor_kind, p_actor_id
  );

  insert into public.mission_events(
    id, tenant_id, mission_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, idempotency_key, payload, trust
  ) values (
    v_event_id, p_tenant_id, v_mission.id, 1, 'mission.created', p_actor_kind, p_actor_id,
    p_correlation_id, 'mission:create:' || p_correlation_id::text,
    jsonb_build_object('mission', jsonb_build_object(
      'id', v_mission.id,
      'tenantId', v_mission.tenant_id,
      'title', v_mission.title,
      'status', v_mission.status,
      'mandateVersion', v_mission.mandate_version,
      'rootNodeId', v_mission.root_node_id,
      'lastEventSequence', v_mission.last_event_sequence,
      'stateVersion', v_mission.state_version,
      'budgetLimits', v_mission.budget_limits,
      'createdAt', v_mission.created_at,
      'updatedAt', v_mission.updated_at
    )), 'trusted'
  );

  update public.missions
  set last_event_sequence = 1, state_version = 1
  where id = v_mission.id
  returning * into v_mission;

  return v_mission;
end;
$$;

create or replace function public.append_mission_event(
  p_mission_id uuid,
  p_expected_sequence bigint,
  p_event_type text,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_payload jsonb,
  p_trust text,
  p_causation_id uuid default null,
  p_idempotency_key text default null,
  p_mission_status text default null,
  p_node_id uuid default null,
  p_node_status text default null
)
returns public.mission_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_event public.mission_events;
  v_sequence bigint;
begin
  if auth.role() <> 'service_role' then
    if p_event_type not in (
      'mission.cancelled', 'mandate.revised', 'mandate.approved',
      'node.paused', 'node.resumed', 'node.redirected'
    ) or p_trust <> 'trusted' then
      raise exception using errcode = '42501', message = 'User session cannot append this event';
    end if;
    if p_event_type = 'mission.cancelled'
      and (p_mission_status is distinct from 'cancelled' or p_node_id is not null or p_node_status is not null) then
      raise exception using errcode = '22023', message = 'Mission cancellation materialization is invalid';
    end if;
    if p_event_type = 'node.paused'
      and (p_node_id is null or p_node_status is distinct from 'paused' or p_mission_status is not null) then
      raise exception using errcode = '22023', message = 'Node pause materialization is invalid';
    end if;
    if p_event_type = 'node.resumed'
      and (p_node_id is null or p_node_status is distinct from 'running' or p_mission_status is not null) then
      raise exception using errcode = '22023', message = 'Node resume materialization is invalid';
    end if;
    if p_event_type = 'node.redirected'
      and (p_node_id is null or p_node_status is not null or p_mission_status is not null) then
      raise exception using errcode = '22023', message = 'Node redirect materialization is invalid';
    end if;
    if p_event_type in ('mandate.revised', 'mandate.approved')
      and (p_node_id is not null or p_node_status is not null or p_mission_status is not null) then
      raise exception using errcode = '22023', message = 'Mandate materialization is invalid';
    end if;
  end if;
  select * into strict v_mission from public.missions where id = p_mission_id for update;
  if not private.can_write_tenant(v_mission.tenant_id) then
    raise exception using errcode = '42501', message = 'Mission access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);

  if p_idempotency_key is not null then
    select * into v_event from public.mission_events
    where mission_id = p_mission_id and idempotency_key = p_idempotency_key;
    if found then
      if v_event.event_type <> p_event_type or v_event.payload <> p_payload then
        raise exception using errcode = '23505', message = 'Idempotency key conflict';
      end if;
      return v_event;
    end if;
  end if;
  if v_mission.last_event_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'Mission sequence conflict';
  end if;
  if char_length(p_event_type) not between 3 and 120
    or p_trust not in ('trusted', 'untrusted', 'derived')
    or octet_length(p_payload::text) > 65536 then
    raise exception using errcode = '22023', message = 'Event input is invalid or out of bounds';
  end if;
  if p_causation_id is not null and not exists (
    select 1 from public.mission_events
    where id = p_causation_id and mission_id = p_mission_id
  ) then
    raise exception using errcode = '23503', message = 'Causation event is outside the mission';
  end if;

  v_sequence := v_mission.last_event_sequence + 1;

  if p_event_type = 'node.planned' then
    if p_node_id is null
      or jsonb_typeof(p_payload->'node') <> 'object'
      or p_payload->'node'->>'id' <> p_node_id::text then
      raise exception using errcode = '22023', message = 'node.planned requires a matching bounded node payload';
    end if;
    insert into public.mission_nodes(
      id, tenant_id, mission_id, parent_id, codename, role_label, objective, status,
      required_capabilities, input_refs, output_refs, budget_limits
    ) values (
      p_node_id, v_mission.tenant_id, p_mission_id,
      (p_payload->'node'->>'parentId')::uuid,
      p_payload->'node'->>'codename',
      p_payload->'node'->>'roleLabel',
      p_payload->'node'->>'objective',
      coalesce(p_payload->'node'->>'status', 'planned'),
      coalesce(p_payload->'node'->'requiredCapabilities', '[]'::jsonb),
      coalesce(p_payload->'node'->'inputRefs', '[]'::jsonb),
      coalesce(p_payload->'node'->'outputRefs', '[]'::jsonb),
      coalesce(p_payload->'node'->'budgetLimits', '{}'::jsonb)
    );
  elsif p_event_type = 'node.redirected' then
    update public.mission_nodes
    set objective = p_payload->>'objective', version = version + 1
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id and id = p_node_id;
    if not found then
      raise exception using errcode = '23503', message = 'Redirected node is outside the mission';
    end if;
  elsif p_event_type = 'dependency.added' then
    if jsonb_typeof(p_payload->'edge') <> 'object' then
      raise exception using errcode = '22023', message = 'dependency.added requires an edge payload';
    end if;
    insert into public.mission_edges(
      id, tenant_id, mission_id, from_node_id, to_node_id, kind, condition
    ) values (
      (p_payload->'edge'->>'id')::uuid, v_mission.tenant_id, p_mission_id,
      (p_payload->'edge'->>'fromNodeId')::uuid,
      (p_payload->'edge'->>'toNodeId')::uuid,
      p_payload->'edge'->>'kind', p_payload->'edge'->'condition'
    );
  elsif p_event_type = 'dependency.removed' then
    delete from public.mission_edges
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id
      and id = (p_payload->>'edgeId')::uuid;
    if not found then
      raise exception using errcode = '23503', message = 'Removed dependency is outside the mission';
    end if;
  elsif p_event_type = 'dependency.rerouted' then
    delete from public.mission_edges
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id
      and id = (p_payload->>'removedEdgeId')::uuid;
    if not found or jsonb_typeof(p_payload->'edge') <> 'object' then
      raise exception using errcode = '23503', message = 'Rerouted dependency is invalid';
    end if;
    insert into public.mission_edges(
      id, tenant_id, mission_id, from_node_id, to_node_id, kind, condition
    ) values (
      (p_payload->'edge'->>'id')::uuid, v_mission.tenant_id, p_mission_id,
      (p_payload->'edge'->>'fromNodeId')::uuid,
      (p_payload->'edge'->>'toNodeId')::uuid,
      p_payload->'edge'->>'kind', p_payload->'edge'->'condition'
    );
  elsif p_event_type = 'mandate.revised' then
    if jsonb_typeof(p_payload->'mandate') <> 'object'
      or (p_payload->'mandate'->>'version')::integer <> v_mission.mandate_version + 1 then
      raise exception using errcode = '40001', message = 'Mandate revision version conflict';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(p_payload->'mandate'->'selectedContextCardIds', '[]'::jsonb)
      ) selected_card_id
      where not exists (
        select 1 from public.context_cards
        where tenant_id = v_mission.tenant_id and id = selected_card_id::uuid
      )
    ) then
      raise exception using errcode = '23503', message = 'Context card is outside the tenant';
    end if;
    insert into public.mission_mandates(
      tenant_id, mission_id, version, goal, constraints, authority,
      selected_context_card_ids, created_by_kind, created_by_id
    ) values (
      v_mission.tenant_id, p_mission_id,
      (p_payload->'mandate'->>'version')::integer,
      p_payload->'mandate'->>'goal',
      coalesce(p_payload->'mandate'->'constraints', '[]'::jsonb),
      coalesce(p_payload->'mandate'->'authority', '{}'::jsonb),
      coalesce(array(
        select value::uuid
        from jsonb_array_elements_text(
          coalesce(p_payload->'mandate'->'selectedContextCardIds', '[]'::jsonb)
        ) value
      ), '{}'),
      p_actor_kind, p_actor_id
    );
    update public.missions
    set mandate_version = (p_payload->'mandate'->>'version')::integer
    where id = p_mission_id;
  elsif p_event_type = 'mandate.approved' then
    update public.mission_mandates set approved_at = now()
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id
      and version = v_mission.mandate_version and approved_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'Mandate is missing or already approved';
    end if;
  end if;

  insert into public.mission_events(
    tenant_id, mission_id, node_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, causation_id, idempotency_key, payload, trust
  ) values (
    v_mission.tenant_id, p_mission_id, p_node_id, v_sequence, p_event_type,
    p_actor_kind, p_actor_id, p_correlation_id, p_causation_id, p_idempotency_key,
    p_payload, p_trust
  ) returning * into v_event;

  if p_node_status is not null then
    if p_node_id is null then
      raise exception using errcode = '22023', message = 'Node status requires a node id';
    end if;
    update public.mission_nodes
    set status = p_node_status, version = version + 1
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id and id = p_node_id;
    if not found then
      raise exception using errcode = '23503', message = 'Node is outside the mission';
    end if;
  end if;

  update public.missions
  set last_event_sequence = v_sequence,
      state_version = state_version + 1,
      status = coalesce(p_mission_status, status)
  where id = p_mission_id;

  return v_event;
end;
$$;

create or replace function public.request_mission_approval(
  p_mission_id uuid,
  p_node_id uuid,
  p_expected_sequence bigint,
  p_category text,
  p_action_fingerprint text,
  p_recommendation text,
  p_alternatives jsonb,
  p_evidence jsonb,
  p_consequence text,
  p_mandate_version integer,
  p_expires_at timestamptz,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns public.mission_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_approval public.mission_approvals;
  v_approval_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_sequence bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  select * into strict v_mission from public.missions where id = p_mission_id for update;
  if not private.can_write_tenant(v_mission.tenant_id) then
    raise exception using errcode = '42501', message = 'Mission access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);

  select a.* into v_approval
  from public.mission_approvals a
  join public.mission_events e on e.id = a.request_event_id
  where a.mission_id = p_mission_id and e.idempotency_key = p_idempotency_key;
  if found then return v_approval; end if;
  if v_mission.last_event_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'Mission sequence conflict';
  end if;
  if p_mandate_version <> v_mission.mandate_version then
    raise exception using errcode = '40001', message = 'Mandate version conflict';
  end if;
  if jsonb_typeof(p_alternatives) <> 'array' or jsonb_typeof(p_evidence) <> 'array' then
    raise exception using errcode = '22023', message = 'Approval evidence and alternatives must be arrays';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'Approval expiry must be in the future';
  end if;
  if p_node_id is not null and not exists (
    select 1 from public.mission_nodes
    where tenant_id = v_mission.tenant_id and mission_id = p_mission_id and id = p_node_id
  ) then
    raise exception using errcode = '23503', message = 'Node is outside the mission';
  end if;

  v_sequence := v_mission.last_event_sequence + 1;
  insert into public.mission_events(
    id, tenant_id, mission_id, node_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, idempotency_key, payload, trust
  ) values (
    v_event_id, v_mission.tenant_id, p_mission_id, p_node_id, v_sequence,
    'approval.requested', p_actor_kind, p_actor_id, p_correlation_id, p_idempotency_key,
    jsonb_build_object('approval', jsonb_build_object(
      'id', v_approval_id, 'tenantId', v_mission.tenant_id, 'missionId', p_mission_id,
      'nodeId', p_node_id, 'status', 'pending', 'category', p_category,
      'actionFingerprint', p_action_fingerprint, 'recommendation', p_recommendation,
      'alternatives', p_alternatives, 'evidence', p_evidence, 'consequence', p_consequence,
      'mandateVersion', p_mandate_version, 'expiresAt', p_expires_at,
      'resolvedAt', null, 'resolution', null
    )), 'derived'
  );

  insert into public.mission_approvals(
    id, tenant_id, mission_id, node_id, request_event_id, category, action_fingerprint,
    recommendation, alternatives, evidence, consequence, mandate_version, expires_at
  ) values (
    v_approval_id, v_mission.tenant_id, p_mission_id, p_node_id, v_event_id, p_category,
    p_action_fingerprint, p_recommendation, p_alternatives, p_evidence, p_consequence,
    p_mandate_version, p_expires_at
  ) returning * into v_approval;

  if p_node_id is not null then
    update public.mission_nodes set status = 'needs_approval', version = version + 1
    where id = p_node_id and mission_id = p_mission_id;
  end if;
  update public.missions
  set last_event_sequence = v_sequence, state_version = state_version + 1, status = 'waiting'
  where id = p_mission_id;
  return v_approval;
end;
$$;

create or replace function public.resolve_mission_approval(
  p_approval_id uuid,
  p_decision text,
  p_resolution jsonb,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns public.mission_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.mission_approvals;
  v_mission public.missions;
  v_event_id uuid := gen_random_uuid();
  v_sequence bigint;
  v_status text;
  v_event_type text := 'approval.resolved';
begin
  select * into strict v_approval from public.mission_approvals
  where id = p_approval_id for update;
  if not private.can_write_tenant(v_approval.tenant_id) then
    raise exception using errcode = '42501', message = 'Approval access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);

  if v_approval.status <> 'pending' then
    if v_approval.resolution_idempotency_key = p_idempotency_key then
      return v_approval;
    end if;
    raise exception using errcode = '23505', message = 'Approval has already been settled';
  end if;
  if p_decision not in ('accepted', 'modified', 'rejected') then
    raise exception using errcode = '22023', message = 'Invalid approval decision';
  end if;
  if octet_length(p_resolution::text) > 65536 then
    raise exception using errcode = '22023', message = 'Approval resolution is out of bounds';
  end if;

  select * into strict v_mission from public.missions
  where id = v_approval.mission_id for update;
  v_sequence := v_mission.last_event_sequence + 1;
  if v_approval.expires_at is not null and v_approval.expires_at <= now() then
    v_status := 'expired';
    v_event_type := 'approval.expired';
  else
    v_status := case when p_decision = 'rejected' then 'rejected' else 'resolved' end;
  end if;

  insert into public.mission_events(
    id, tenant_id, mission_id, node_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, idempotency_key, payload, trust
  ) values (
    v_event_id, v_approval.tenant_id, v_approval.mission_id, v_approval.node_id,
    v_sequence, v_event_type, p_actor_kind, p_actor_id, p_correlation_id,
    p_idempotency_key, jsonb_build_object(
      'approvalId', p_approval_id, 'status', v_status, 'decision', p_decision,
      'resolution', p_resolution
    ), 'trusted'
  );

  update public.mission_approvals
  set status = v_status,
      resolution_event_id = v_event_id,
      resolved_by = p_actor_id,
      resolved_at = now(),
      resolution = p_resolution,
      resolution_idempotency_key = p_idempotency_key
  where id = p_approval_id and status = 'pending'
  returning * into strict v_approval;

  update public.missions
  set last_event_sequence = v_sequence, state_version = state_version + 1
  where id = v_approval.mission_id;
  return v_approval;
end;
$$;

create or replace function public.create_mission_checkpoint(
  p_mission_id uuid,
  p_node_id uuid,
  p_expected_sequence bigint,
  p_label text,
  p_snapshot jsonb,
  p_digest text,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns public.mission_checkpoints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_checkpoint public.mission_checkpoints;
  v_sequence bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  select * into strict v_mission from public.missions where id = p_mission_id for update;
  if not private.can_write_tenant(v_mission.tenant_id) then
    raise exception using errcode = '42501', message = 'Mission access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);

  select c.* into v_checkpoint
  from public.mission_checkpoints c
  join public.mission_events e on e.mission_id = c.mission_id and e.sequence = c.sequence
  where c.mission_id = p_mission_id and e.idempotency_key = p_idempotency_key;
  if found then return v_checkpoint; end if;
  if v_mission.last_event_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'Mission sequence conflict';
  end if;
  if jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 1048576
    or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Checkpoint input is invalid or out of bounds';
  end if;
  v_sequence := v_mission.last_event_sequence + 1;

  insert into public.mission_checkpoints(
    tenant_id, mission_id, node_id, sequence, label, snapshot, digest,
    created_by_kind, created_by_id
  ) values (
    v_mission.tenant_id, p_mission_id, p_node_id, v_sequence, p_label, p_snapshot,
    p_digest, p_actor_kind, p_actor_id
  ) returning * into v_checkpoint;

  insert into public.mission_events(
    tenant_id, mission_id, node_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, idempotency_key, payload, trust
  ) values (
    v_mission.tenant_id, p_mission_id, p_node_id, v_sequence, 'checkpoint.created',
    p_actor_kind, p_actor_id, p_correlation_id, p_idempotency_key,
    jsonb_build_object('checkpointId', v_checkpoint.id, 'digest', p_digest), 'derived'
  );
  update public.missions
  set last_event_sequence = v_sequence, state_version = state_version + 1
  where id = p_mission_id;
  return v_checkpoint;
end;
$$;

create or replace function public.revert_mission_to_checkpoint(
  p_mission_id uuid,
  p_checkpoint_id uuid,
  p_expected_sequence bigint,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns public.mission_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_checkpoint public.mission_checkpoints;
  v_event public.mission_events;
  v_sequence bigint;
begin
  select * into strict v_mission from public.missions where id = p_mission_id for update;
  if not private.can_write_tenant(v_mission.tenant_id) then
    raise exception using errcode = '42501', message = 'Mission access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);

  select * into v_event from public.mission_events
  where mission_id = p_mission_id and idempotency_key = p_idempotency_key;
  if found then return v_event; end if;
  select * into strict v_checkpoint from public.mission_checkpoints
  where id = p_checkpoint_id and mission_id = p_mission_id;
  if v_mission.last_event_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'Mission sequence conflict';
  end if;
  if jsonb_typeof(v_checkpoint.snapshot->'mission') <> 'object'
    or jsonb_typeof(v_checkpoint.snapshot->'nodes') <> 'array' then
    raise exception using errcode = '22023', message = 'Checkpoint snapshot is not restorable';
  end if;

  update public.missions
  set status = v_checkpoint.snapshot->'mission'->>'status',
      mandate_version = (v_checkpoint.snapshot->'mission'->>'mandateVersion')::integer
  where id = p_mission_id;

  update public.mission_nodes n
  set status = restored.status, version = n.version + 1
  from (
    select (item->>'id')::uuid as id, item->>'status' as status
    from jsonb_array_elements(v_checkpoint.snapshot->'nodes') item
  ) restored
  where n.tenant_id = v_mission.tenant_id
    and n.mission_id = p_mission_id
    and n.id = restored.id;

  v_sequence := v_mission.last_event_sequence + 1;
  insert into public.mission_events(
    tenant_id, mission_id, sequence, event_type, actor_kind, actor_id,
    correlation_id, idempotency_key, payload, trust
  ) values (
    v_mission.tenant_id, p_mission_id, v_sequence, 'mission.reverted', p_actor_kind,
    p_actor_id, p_correlation_id, p_idempotency_key,
    jsonb_build_object(
      'checkpointId', p_checkpoint_id,
      'digest', v_checkpoint.digest,
      'snapshot', v_checkpoint.snapshot
    ), 'trusted'
  ) returning * into v_event;
  update public.missions
  set last_event_sequence = v_sequence, state_version = state_version + 1
  where id = p_mission_id;
  return v_event;
end;
$$;

create or replace function public.reserve_idempotency(
  p_tenant_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_expires_at timestamptz
)
returns public.idempotency_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.idempotency_records;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if not private.can_write_tenant(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Tenant access denied';
  end if;
  if p_request_fingerprint !~ '^[a-f0-9]{64}$' or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'Invalid idempotency reservation';
  end if;
  insert into public.idempotency_records(
    tenant_id, scope, idempotency_key, request_fingerprint, expires_at
  ) values (
    p_tenant_id, p_scope, p_idempotency_key, p_request_fingerprint, p_expires_at
  ) on conflict (tenant_id, scope, idempotency_key) do nothing;

  select * into strict v_record from public.idempotency_records
  where tenant_id = p_tenant_id and scope = p_scope and idempotency_key = p_idempotency_key
  for update;
  if v_record.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = '23505', message = 'Idempotency key conflict';
  end if;
  return v_record;
end;
$$;

create or replace function public.complete_idempotency(
  p_tenant_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_status text,
  p_response_ref jsonb
)
returns public.idempotency_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.idempotency_records;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if not private.can_write_tenant(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Tenant access denied';
  end if;
  if p_status not in ('succeeded', 'failed_retryable', 'failed_terminal', 'cancelled')
    or octet_length(p_response_ref::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid idempotency completion';
  end if;
  update public.idempotency_records
  set status = p_status, response_ref = p_response_ref
  where tenant_id = p_tenant_id and scope = p_scope
    and idempotency_key = p_idempotency_key
    and request_fingerprint = p_request_fingerprint
    and status in ('reserved', 'running', 'failed_retryable')
  returning * into v_record;
  if not found then
    raise exception using errcode = '40001', message = 'Idempotency record is missing or terminal';
  end if;
  return v_record;
end;
$$;

create or replace function public.consume_usage(
  p_tenant_id uuid,
  p_mission_id uuid,
  p_node_id uuid,
  p_subject_kind text,
  p_subject_id text,
  p_metric text,
  p_quantity numeric,
  p_cost_microunits bigint,
  p_limit_quantity numeric,
  p_limit_cost_microunits bigint,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.usage_ledger;
  v_used numeric;
  v_cost bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if not private.can_write_tenant(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Tenant access denied';
  end if;
  if p_quantity < 0 or p_cost_microunits < 0 or p_limit_quantity < 0
    or p_limit_cost_microunits < 0 or p_window_end <= p_window_start then
    raise exception using errcode = '22023', message = 'Invalid usage debit';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_tenant_id::text || ':' || p_subject_kind || ':' || p_subject_id || ':' || p_metric || ':' || p_window_start::text,
      0
    )
  );

  select * into v_existing from public.usage_ledger
  where tenant_id = p_tenant_id and subject_kind = p_subject_kind
    and subject_id = p_subject_id and metric = p_metric
    and idempotency_key = p_idempotency_key;

  select coalesce(sum(quantity), 0), coalesce(sum(cost_microunits), 0)
  into v_used, v_cost
  from public.usage_ledger
  where tenant_id = p_tenant_id and subject_kind = p_subject_kind
    and subject_id = p_subject_id and metric = p_metric
    and window_start = p_window_start and window_end = p_window_end;

  if found and v_existing.id is not null then
    return jsonb_build_object(
      'entry', to_jsonb(v_existing), 'totalQuantity', v_used, 'totalCostMicrounits', v_cost
    );
  end if;
  if v_used + p_quantity > p_limit_quantity then
    raise exception using errcode = 'P0001', message = 'Quota exhausted';
  end if;
  if v_cost + p_cost_microunits > p_limit_cost_microunits then
    raise exception using errcode = 'P0001', message = 'Cost budget exhausted';
  end if;

  insert into public.usage_ledger(
    tenant_id, mission_id, node_id, subject_kind, subject_id, metric, quantity,
    cost_microunits, window_start, window_end, idempotency_key, correlation_id
  ) values (
    p_tenant_id, p_mission_id, p_node_id, p_subject_kind, p_subject_id, p_metric,
    p_quantity, p_cost_microunits, p_window_start, p_window_end, p_idempotency_key,
    p_correlation_id
  ) returning * into v_existing;
  return jsonb_build_object(
    'entry', to_jsonb(v_existing),
    'totalQuantity', v_used + p_quantity,
    'totalCostMicrounits', v_cost + p_cost_microunits
  );
end;
$$;

create or replace function public.reserve_guest_mission(
  p_session_token_hash text,
  p_ip_signal_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.guest_sessions;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if p_session_token_hash !~ '^[a-f0-9]{64}$'
    or (p_ip_signal_hash is not null and p_ip_signal_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode = '22023', message = 'Only hashed guest signals are accepted';
  end if;
  update public.guest_sessions
  set missions_created = missions_created + 1,
      ip_signal_hash = coalesce(ip_signal_hash, p_ip_signal_hash)
  where session_token_hash = p_session_token_hash
    and revoked_at is null and expires_at > now()
    and missions_created < mission_limit
  returning * into v_session;
  if not found then
    raise exception using errcode = 'P0001', message = 'Guest mission quota exhausted or session invalid';
  end if;
  return jsonb_build_object('tenantId', v_session.tenant_id, 'used', v_session.missions_created, 'limit', v_session.mission_limit);
end;
$$;

create or replace function public.reserve_judge_run(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.judge_access;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Only judge-code hashes are accepted';
  end if;
  update public.judge_access
  set used_runs = used_runs + 1
  where code_hash = p_code_hash and revoked_at is null
    and (expires_at is null or expires_at > now()) and used_runs < max_runs
  returning * into v_access;
  if not found then
    raise exception using errcode = 'P0001', message = 'Judge run quota exhausted or code invalid';
  end if;
  return jsonb_build_object('tenantId', v_access.tenant_id, 'used', v_access.used_runs, 'limit', v_access.max_runs);
end;
$$;

create or replace function public.record_security_event(
  p_tenant_id uuid,
  p_mission_id uuid,
  p_event_type text,
  p_severity text,
  p_actor_kind text,
  p_actor_id text,
  p_ip_signal_hash text,
  p_origin text,
  p_redacted_payload jsonb,
  p_correlation_id uuid
)
returns public.security_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.security_events;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required';
  end if;
  if not private.can_write_tenant(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Tenant access denied';
  end if;
  perform private.assert_actor(p_actor_kind, p_actor_id);
  if p_ip_signal_hash is not null and p_ip_signal_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Only hashed IP abuse signals are accepted';
  end if;
  if octet_length(p_redacted_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Security event payload is out of bounds';
  end if;
  insert into public.security_events(
    tenant_id, mission_id, event_type, severity, actor_kind, actor_id,
    ip_signal_hash, origin, redacted_payload, correlation_id
  ) values (
    p_tenant_id, p_mission_id, p_event_type, p_severity, p_actor_kind, p_actor_id,
    p_ip_signal_hash, p_origin, p_redacted_payload, p_correlation_id
  ) returning * into v_event;
  return v_event;
end;
$$;

commit;
