-- Deterministic business-rule conflicts previously raised SQLSTATE 40001
-- (serialization_failure), which the Supabase request path treats as
-- transient and auto-retries, stalling routine optimistic-concurrency
-- rejections for up to 60s. These are permanent rejections, so re-raise
-- them as 55000 (object_not_in_prerequisite_state), which is never
-- retried. Function bodies are otherwise identical to 20260826000200.

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
    raise exception using errcode = '55000', message = 'Mission sequence conflict';
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
      raise exception using errcode = '55000', message = 'Mandate revision version conflict';
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
      raise exception using errcode = '55000', message = 'Mandate is missing or already approved';
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
    raise exception using errcode = '55000', message = 'Mission sequence conflict';
  end if;
  if p_mandate_version <> v_mission.mandate_version then
    raise exception using errcode = '55000', message = 'Mandate version conflict';
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
    raise exception using errcode = '55000', message = 'Mission sequence conflict';
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
    raise exception using errcode = '55000', message = 'Mission sequence conflict';
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
    raise exception using errcode = '55000', message = 'Idempotency record is missing or terminal';
  end if;
  return v_record;
end;
$$;
