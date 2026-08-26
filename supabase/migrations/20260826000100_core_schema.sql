begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete restrict,
  scope text not null check (scope in ('user', 'guest', 'judge', 'public_fixture', 'system')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint tenants_owner_scope_check check (
    (scope = 'user' and owner_user_id is not null)
    or (scope <> 'user' and owner_user_id is null)
  )
);

create unique index tenants_one_user_scope_idx
  on public.tenants(owner_user_id)
  where scope = 'user';

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.context_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 4000),
  connector_refs text[] not null default '{}',
  memory_scopes text[] not null default '{}',
  authority_overrides jsonb,
  visual_theme text not null default 'default' check (char_length(visual_theme) between 1 and 120),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint context_cards_authority_object check (
    authority_overrides is null or jsonb_typeof(authority_overrides) = 'object'
  )
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft' check (
    status in ('draft', 'planning', 'running', 'waiting', 'completed', 'failed', 'cancelled')
  ),
  mandate_version integer not null default 1 check (mandate_version > 0),
  root_node_id uuid,
  last_event_sequence bigint not null default 0 check (last_event_sequence >= 0),
  state_version bigint not null default 0 check (state_version >= 0),
  budget_limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint missions_budget_object check (jsonb_typeof(budget_limits) = 'object')
);

create table public.mission_mandates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  version integer not null check (version > 0),
  goal text not null check (char_length(goal) between 1 and 8000),
  constraints jsonb not null default '[]'::jsonb,
  authority jsonb not null default '{}'::jsonb,
  selected_context_card_ids uuid[] not null default '{}',
  created_by_kind text not null check (created_by_kind in ('user', 'cardea', 'system')),
  created_by_id text not null check (char_length(created_by_id) between 1 and 200),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_id, version),
  unique (tenant_id, mission_id, version),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  constraint mission_mandates_constraints_array check (jsonb_typeof(constraints) = 'array'),
  constraint mission_mandates_authority_object check (jsonb_typeof(authority) = 'object')
);

create table public.mission_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  parent_id uuid,
  codename text not null check (char_length(codename) between 1 and 120),
  role_label text not null check (char_length(role_label) between 1 and 160),
  objective text not null check (char_length(objective) between 1 and 8000),
  status text not null default 'planned' check (
    status in ('planned', 'running', 'paused', 'waiting', 'needs_approval', 'completed', 'failed', 'cancelled')
  ),
  required_capabilities jsonb not null default '[]'::jsonb,
  input_refs jsonb not null default '[]'::jsonb,
  output_refs jsonb not null default '[]'::jsonb,
  budget_limits jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, mission_id, id),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, parent_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  constraint mission_nodes_required_capabilities_array check (jsonb_typeof(required_capabilities) = 'array'),
  constraint mission_nodes_input_refs_array check (jsonb_typeof(input_refs) = 'array'),
  constraint mission_nodes_output_refs_array check (jsonb_typeof(output_refs) = 'array'),
  constraint mission_nodes_budget_object check (jsonb_typeof(budget_limits) = 'object')
);

alter table public.missions
  add constraint missions_root_node_tenant_fk
  foreign key (tenant_id, root_node_id) references public.mission_nodes(tenant_id, id) on delete restrict;

create table public.mission_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  from_node_id uuid not null,
  to_node_id uuid not null,
  kind text not null check (kind in ('depends_on', 'blocks', 'informs', 'approves')),
  condition jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (mission_id, from_node_id, to_node_id, kind),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, from_node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, to_node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete cascade,
  constraint mission_edges_no_self_reference check (from_node_id <> to_node_id)
);

create table public.mission_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  node_id uuid,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (char_length(event_type) between 3 and 120),
  actor_kind text not null check (actor_kind in ('user', 'cardea', 'tool', 'system')),
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  correlation_id uuid not null,
  causation_id uuid,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  trust text not null check (trust in ('trusted', 'untrusted', 'derived')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, mission_id, id),
  unique (mission_id, sequence),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  foreign key (causation_id) references public.mission_events(id) on delete restrict,
  constraint mission_events_payload_bound check (octet_length(payload::text) <= 65536)
);

create unique index mission_events_idempotency_idx
  on public.mission_events(mission_id, idempotency_key)
  where idempotency_key is not null;

create table public.mission_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  node_id uuid,
  request_event_id uuid not null,
  resolution_event_id uuid,
  status text not null default 'pending' check (
    status in ('pending', 'resolved', 'rejected', 'expired', 'cancelled')
  ),
  category text not null check (char_length(category) between 1 and 120),
  action_fingerprint text not null check (char_length(action_fingerprint) between 16 and 200),
  recommendation text not null check (char_length(recommendation) between 1 and 8000),
  alternatives jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  consequence text not null check (char_length(consequence) between 1 and 8000),
  mandate_version integer not null check (mandate_version > 0),
  expires_at timestamptz,
  resolved_by text,
  resolved_at timestamptz,
  resolution jsonb,
  resolution_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  foreign key (tenant_id, mission_id, request_event_id)
    references public.mission_events(tenant_id, mission_id, id) on delete restrict,
  foreign key (tenant_id, mission_id, resolution_event_id)
    references public.mission_events(tenant_id, mission_id, id) on delete restrict,
  constraint mission_approvals_alternatives_array check (jsonb_typeof(alternatives) = 'array'),
  constraint mission_approvals_evidence_array check (jsonb_typeof(evidence) = 'array'),
  constraint mission_approvals_resolution_consistency check (
    (status = 'pending' and resolved_at is null and resolved_by is null and resolution_event_id is null)
    or (status <> 'pending' and resolved_at is not null)
  )
);

create table public.mission_checkpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  node_id uuid,
  sequence bigint not null check (sequence > 0),
  label text not null check (char_length(label) between 1 and 200),
  snapshot jsonb not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  created_by_kind text not null check (created_by_kind in ('user', 'cardea', 'system')),
  created_by_id text not null check (char_length(created_by_id) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (mission_id, sequence),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  constraint mission_checkpoints_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint mission_checkpoints_snapshot_bound check (octet_length(snapshot::text) <= 1048576)
);

create table public.capability_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 120),
  external_ref text not null check (char_length(external_ref) between 1 and 500),
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  input_schema jsonb not null,
  output_schema jsonb,
  risk jsonb not null,
  trust jsonb not null,
  allowed_origins text[] not null default '{}',
  config_ref text check (config_ref is null or char_length(config_ref) <= 500),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, external_ref),
  constraint capability_sources_input_schema_bound check (octet_length(input_schema::text) <= 131072),
  constraint capability_sources_output_schema_bound check (
    output_schema is null or octet_length(output_schema::text) <= 131072
  ),
  constraint capability_sources_risk_object check (jsonb_typeof(risk) = 'object'),
  constraint capability_sources_trust_object check (jsonb_typeof(trust) = 'object')
);

create table public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mission_id uuid not null,
  node_id uuid,
  capability_source_id uuid not null,
  request_event_id uuid,
  result_event_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  action text not null check (char_length(action) between 1 and 200),
  origin text not null check (char_length(origin) between 1 and 2048),
  target jsonb not null,
  status text not null default 'reserved' check (
    status in ('reserved', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  request_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb,
  error_summary jsonb,
  provider_execution_id text,
  attempt integer not null default 1 check (attempt between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (mission_id, idempotency_key),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  foreign key (tenant_id, capability_source_id)
    references public.capability_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, mission_id, request_event_id)
    references public.mission_events(tenant_id, mission_id, id) on delete restrict,
  foreign key (tenant_id, mission_id, result_event_id)
    references public.mission_events(tenant_id, mission_id, id) on delete restrict,
  constraint tool_runs_request_summary_bound check (octet_length(request_summary::text) <= 65536),
  constraint tool_runs_result_summary_bound check (
    result_summary is null or octet_length(result_summary::text) <= 65536
  ),
  constraint tool_runs_error_summary_bound check (
    error_summary is null or octet_length(error_summary::text) <= 16384
  )
);

create table public.memory_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mission_id uuid,
  node_id uuid,
  context_card_id uuid,
  provider text not null check (char_length(provider) between 1 and 120),
  external_ref text not null check (char_length(external_ref) between 1 and 500),
  version integer not null default 1 check (version > 0),
  source jsonb not null,
  influence text not null default '' check (char_length(influence) <= 8000),
  status text not null default 'proposed' check (status in ('proposed', 'promoted', 'forgotten', 'deleted')),
  promoted_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, external_ref, version),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  foreign key (tenant_id, context_card_id)
    references public.context_cards(tenant_id, id) on delete restrict,
  constraint memory_refs_source_bound check (octet_length(source::text) <= 65536)
);

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mission_id uuid,
  node_id uuid,
  subject_kind text not null check (subject_kind in ('user', 'guest', 'judge', 'mission', 'node', 'provider')),
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  metric text not null check (char_length(metric) between 1 and 120),
  quantity numeric(20, 6) not null check (quantity >= 0),
  cost_microunits bigint not null default 0 check (cost_microunits >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, subject_kind, subject_id, metric, idempotency_key),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mission_id, node_id)
    references public.mission_nodes(tenant_id, mission_id, id) on delete restrict,
  constraint usage_ledger_window_check check (window_end > window_start)
);

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  session_token_hash text not null unique check (session_token_hash ~ '^[a-f0-9]{64}$'),
  ip_signal_hash text check (ip_signal_hash is null or ip_signal_hash ~ '^[a-f0-9]{64}$'),
  mission_limit integer not null default 1 check (mission_limit between 0 and 100),
  missions_created integer not null default 0 check (missions_created >= 0 and missions_created <= mission_limit),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.judge_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  max_runs integer not null default 10 check (max_runs between 1 and 10),
  used_runs integer not null default 0 check (used_runs >= 0 and used_runs <= max_runs),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mission_id uuid,
  event_type text not null check (char_length(event_type) between 3 and 120),
  severity text not null check (severity in ('info', 'warning', 'high', 'critical')),
  actor_kind text not null check (actor_kind in ('user', 'cardea', 'tool', 'system')),
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  ip_signal_hash text check (ip_signal_hash is null or ip_signal_hash ~ '^[a-f0-9]{64}$'),
  origin text,
  redacted_payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, mission_id) references public.missions(tenant_id, id) on delete cascade,
  constraint security_events_payload_bound check (octet_length(redacted_payload::text) <= 16384)
);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (char_length(scope) between 1 and 200),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'reserved' check (
    status in ('reserved', 'running', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled')
  ),
  response_ref jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope, idempotency_key),
  constraint idempotency_records_response_bound check (
    response_ref is null or octet_length(response_ref::text) <= 16384
  )
);

create index tenant_memberships_user_idx on public.tenant_memberships(user_id, tenant_id);
create index missions_tenant_status_idx on public.missions(tenant_id, status, updated_at desc);
create index mission_nodes_mission_status_idx on public.mission_nodes(mission_id, status);
create index mission_edges_mission_idx on public.mission_edges(mission_id);
create index mission_events_mission_sequence_idx on public.mission_events(mission_id, sequence);
create index mission_approvals_pending_idx on public.mission_approvals(mission_id, created_at)
  where status = 'pending';
create unique index mission_approvals_one_pending_action_idx
  on public.mission_approvals(mission_id, action_fingerprint, mandate_version)
  where status = 'pending';
create index mission_checkpoints_mission_sequence_idx on public.mission_checkpoints(mission_id, sequence desc);
create index tool_runs_mission_status_idx on public.tool_runs(mission_id, status, updated_at desc);
create index memory_refs_tenant_status_idx on public.memory_refs(tenant_id, status, updated_at desc);
create index usage_ledger_subject_window_idx
  on public.usage_ledger(tenant_id, subject_kind, subject_id, metric, window_start, window_end);
create index security_events_tenant_created_idx on public.security_events(tenant_id, created_at desc);

commit;
