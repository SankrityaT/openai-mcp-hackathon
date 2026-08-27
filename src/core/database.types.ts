/*
 * Hand-authored from supabase/migrations. Regenerate from the confirmed Cardea
 * project or a local stack before remote deployment.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableShape<TRow, TInsert, TUpdate = Partial<TInsert>> = {
  Row: TRow;
  Insert: TInsert;
  Update: TUpdate;
  Relationships: [];
};

type Timestamps = { created_at: string; updated_at: string };
type TenantScoped = { tenant_id: string };

export type TenantRow = {
  id: string;
  owner_user_id: string | null;
  scope: "user" | "guest" | "judge" | "public_fixture" | "system";
  display_name: string;
  created_at: string;
};

export type MissionRow = TenantScoped & Timestamps & {
  id: string;
  title: string;
  status: "draft" | "planning" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  mandate_version: number;
  root_node_id: string | null;
  last_event_sequence: number;
  state_version: number;
  budget_limits: Json;
};

export type MissionMandateRow = TenantScoped & {
  id: string;
  mission_id: string;
  version: number;
  goal: string;
  constraints: Json;
  authority: Json;
  selected_context_card_ids: string[];
  created_by_kind: string;
  created_by_id: string;
  approved_at: string | null;
  created_at: string;
};

export type MissionNodeRow = TenantScoped & Timestamps & {
  id: string;
  mission_id: string;
  parent_id: string | null;
  codename: string;
  role_label: string;
  objective: string;
  status: string;
  required_capabilities: Json;
  input_refs: Json;
  output_refs: Json;
  budget_limits: Json;
  version: number;
};

export type MissionEdgeRow = TenantScoped & {
  id: string;
  mission_id: string;
  from_node_id: string;
  to_node_id: string;
  kind: string;
  condition: Json | null;
  created_at: string;
};

export type MissionEventRow = TenantScoped & {
  id: string;
  mission_id: string;
  node_id: string | null;
  sequence: number;
  event_type: string;
  actor_kind: string;
  actor_id: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string | null;
  payload: Json;
  trust: string;
  created_at: string;
};

export type MissionApprovalRow = TenantScoped & Timestamps & {
  id: string;
  mission_id: string;
  node_id: string | null;
  request_event_id: string;
  resolution_event_id: string | null;
  status: string;
  category: string;
  action_fingerprint: string;
  recommendation: string;
  alternatives: Json;
  evidence: Json;
  consequence: string;
  mandate_version: number;
  expires_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: Json | null;
  resolution_idempotency_key: string | null;
};

export type MissionCheckpointRow = TenantScoped & {
  id: string;
  mission_id: string;
  node_id: string | null;
  sequence: number;
  label: string;
  snapshot: Json;
  digest: string;
  created_by_kind: string;
  created_by_id: string;
  created_at: string;
};

export type CapabilitySourceRow = TenantScoped & Timestamps & {
  id: string;
  provider: string;
  external_ref: string;
  name: string;
  description: string;
  input_schema: Json;
  output_schema: Json | null;
  risk: Json;
  trust: Json;
  allowed_origins: string[];
  config_ref: string | null;
  enabled: boolean;
};

export type ToolRunRow = TenantScoped & Timestamps & {
  id: string;
  mission_id: string;
  node_id: string | null;
  capability_source_id: string;
  request_event_id: string | null;
  result_event_id: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  action: string;
  origin: string;
  target: Json;
  status: string;
  request_summary: Json;
  result_summary: Json | null;
  error_summary: Json | null;
  provider_execution_id: string | null;
  attempt: number;
};

export type ContextCardRow = TenantScoped & Timestamps & {
  id: string;
  name: string;
  description: string | null;
  connector_refs: string[];
  memory_scopes: string[];
  authority_overrides: Json | null;
  visual_theme: string;
  version: number;
};

export type MemoryRefRow = TenantScoped & Timestamps & {
  id: string;
  mission_id: string | null;
  node_id: string | null;
  context_card_id: string | null;
  provider: string;
  external_ref: string;
  version: number;
  source: Json;
  influence: string;
  status: string;
  promoted_by: string | null;
  deleted_at: string | null;
};

export type UsageLedgerRow = TenantScoped & {
  id: string;
  mission_id: string | null;
  node_id: string | null;
  subject_kind: string;
  subject_id: string;
  metric: string;
  quantity: number;
  cost_microunits: number;
  window_start: string;
  window_end: string;
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string;
};

export type GuestSessionRow = TenantScoped & Timestamps & {
  id: string;
  session_token_hash: string;
  ip_signal_hash: string | null;
  mission_limit: number;
  missions_created: number;
  expires_at: string;
  revoked_at: string | null;
};

export type JudgeAccessRow = TenantScoped & Timestamps & {
  id: string;
  code_hash: string;
  max_runs: number;
  used_runs: number;
  expires_at: string | null;
  revoked_at: string | null;
};

export type SecurityEventRow = TenantScoped & {
  id: string;
  mission_id: string | null;
  event_type: string;
  severity: string;
  actor_kind: string;
  actor_id: string;
  ip_signal_hash: string | null;
  origin: string | null;
  redacted_payload: Json;
  correlation_id: string;
  created_at: string;
};

export type IdempotencyRecordRow = TenantScoped & Timestamps & {
  id: string;
  scope: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_ref: Json | null;
  expires_at: string;
};

/**
 * Composio connection metadata. Keyed by `auth.users.id` rather than by
 * tenant: a connected Google account is personal, not shared with whoever
 * else can read the tenant. Holds no credential of any kind, only the opaque
 * Composio connected-account handle. See
 * supabase/migrations/20260827000100_composio_connections.sql.
 */
export type ComposioConnectionRow = Timestamps & {
  id: string;
  user_id: string;
  toolkit: "gmail" | "googlecalendar";
  connected_account_id: string;
  status: "connected" | "pending" | "disconnected" | "error";
};

export interface Database {
  public: {
    Tables: {
      tenants: TableShape<TenantRow, Omit<TenantRow, "id" | "created_at"> & { id?: string; created_at?: string }>;
      tenant_memberships: TableShape<
        { tenant_id: string; user_id: string; role: string; created_at: string },
        { tenant_id: string; user_id: string; role?: string; created_at?: string }
      >;
      missions: TableShape<MissionRow, Omit<MissionRow, "id" | keyof Timestamps | "root_node_id" | "last_event_sequence" | "state_version"> & Partial<Pick<MissionRow, "id" | "root_node_id" | "last_event_sequence" | "state_version">>>;
      mission_mandates: TableShape<MissionMandateRow, Omit<MissionMandateRow, "id" | "approved_at" | "created_at"> & Partial<Pick<MissionMandateRow, "id" | "approved_at" | "created_at">>>;
      mission_nodes: TableShape<MissionNodeRow, Omit<MissionNodeRow, "id" | keyof Timestamps> & Partial<Pick<MissionNodeRow, "id">>>;
      mission_edges: TableShape<MissionEdgeRow, Omit<MissionEdgeRow, "id" | "created_at"> & Partial<Pick<MissionEdgeRow, "id" | "created_at">>>;
      mission_events: TableShape<MissionEventRow, Omit<MissionEventRow, "id" | "sequence" | "created_at"> & Partial<Pick<MissionEventRow, "id" | "sequence" | "created_at">>, never>;
      mission_approvals: TableShape<MissionApprovalRow, Omit<MissionApprovalRow, "id" | keyof Timestamps | "resolution_event_id" | "resolved_by" | "resolved_at" | "resolution" | "resolution_idempotency_key"> & Partial<Pick<MissionApprovalRow, "id" | "resolution_event_id" | "resolved_by" | "resolved_at" | "resolution" | "resolution_idempotency_key">>>;
      mission_checkpoints: TableShape<MissionCheckpointRow, Omit<MissionCheckpointRow, "id" | "created_at"> & Partial<Pick<MissionCheckpointRow, "id" | "created_at">>, never>;
      capability_sources: TableShape<CapabilitySourceRow, Omit<CapabilitySourceRow, "id" | keyof Timestamps> & Partial<Pick<CapabilitySourceRow, "id">>>;
      tool_runs: TableShape<ToolRunRow, Omit<ToolRunRow, "id" | keyof Timestamps | "result_event_id" | "result_summary" | "error_summary" | "provider_execution_id"> & Partial<Pick<ToolRunRow, "id" | "result_event_id" | "result_summary" | "error_summary" | "provider_execution_id">>>;
      context_cards: TableShape<ContextCardRow, Omit<ContextCardRow, "id" | keyof Timestamps> & Partial<Pick<ContextCardRow, "id">>>;
      memory_refs: TableShape<MemoryRefRow, Omit<MemoryRefRow, "id" | keyof Timestamps | "deleted_at"> & Partial<Pick<MemoryRefRow, "id" | "deleted_at">>>;
      usage_ledger: TableShape<UsageLedgerRow, Omit<UsageLedgerRow, "id" | "occurred_at"> & Partial<Pick<UsageLedgerRow, "id" | "occurred_at">>, never>;
      guest_sessions: TableShape<GuestSessionRow, Omit<GuestSessionRow, "id" | keyof Timestamps | "revoked_at"> & Partial<Pick<GuestSessionRow, "id" | "revoked_at">>>;
      judge_access: TableShape<JudgeAccessRow, Omit<JudgeAccessRow, "id" | keyof Timestamps | "revoked_at"> & Partial<Pick<JudgeAccessRow, "id" | "revoked_at">>>;
      security_events: TableShape<SecurityEventRow, Omit<SecurityEventRow, "id" | "created_at"> & Partial<Pick<SecurityEventRow, "id" | "created_at">>, never>;
      idempotency_records: TableShape<IdempotencyRecordRow, Omit<IdempotencyRecordRow, "id" | keyof Timestamps> & Partial<Pick<IdempotencyRecordRow, "id">>>;
      composio_connections: TableShape<ComposioConnectionRow, Omit<ComposioConnectionRow, "id" | keyof Timestamps> & Partial<Pick<ComposioConnectionRow, "id" | keyof Timestamps>>>;
    };
    Views: Record<never, never>;
    Functions: {
      ensure_user_tenant: { Args: { p_display_name?: string }; Returns: TenantRow };
      create_mission: { Args: Record<string, Json>; Returns: MissionRow };
      append_mission_event: { Args: Record<string, Json>; Returns: MissionEventRow };
      request_mission_approval: { Args: Record<string, Json>; Returns: MissionApprovalRow };
      resolve_mission_approval: { Args: Record<string, Json>; Returns: MissionApprovalRow };
      create_mission_checkpoint: { Args: Record<string, Json>; Returns: MissionCheckpointRow };
      revert_mission_to_checkpoint: { Args: Record<string, Json>; Returns: MissionEventRow };
      reserve_idempotency: { Args: Record<string, Json>; Returns: IdempotencyRecordRow };
      complete_idempotency: { Args: Record<string, Json>; Returns: IdempotencyRecordRow };
      consume_usage: { Args: Record<string, Json>; Returns: Json };
      reserve_guest_mission: { Args: { p_session_token_hash: string; p_ip_signal_hash?: string }; Returns: Json };
      reserve_judge_run: { Args: { p_code_hash: string }; Returns: Json };
      record_security_event: { Args: Record<string, Json>; Returns: SecurityEventRow };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
