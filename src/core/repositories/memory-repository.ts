import type { JsonValue } from "../contracts/types";

/**
 * Consent / lifecycle state for a persisted memory reference.
 *
 * "proposed" is reserved for a future silent-proposal surface; the MVP only
 * ever creates rows directly in the "promoted" state because promotion always
 * requires an explicit user action (ARCHITECTURE.md "Supermemory").
 */
export type MemoryConsentState = "proposed" | "promoted" | "forgotten" | "deleted";

export type MemoryRefRecord = {
  id: string;
  tenantId: string;
  missionId: string | null;
  nodeId: string | null;
  contextCardId: string | null;
  provider: string;
  externalRef: string;
  version: number;
  source: JsonValue;
  influence: string;
  status: MemoryConsentState;
  promotedBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryRefInput = {
  tenantId: string;
  missionId?: string;
  nodeId?: string;
  contextCardId?: string;
  provider: string;
  externalRef: string;
  version: number;
  source: JsonValue;
  influence: string;
  status: MemoryConsentState;
  promotedBy: string;
};

export type UpdateMemoryRefInput = {
  id: string;
  tenantId: string;
  version: number;
  source?: JsonValue;
  influence?: string;
};

/**
 * Server-only port for the `memory_refs` table described in
 * docs/CORE_DATA_POLICY.md. Unlike mission tables, `memory_refs` is
 * scoped-CRUD (no RPC indirection required), so implementations may issue
 * direct authenticated PostgREST calls under RLS.
 *
 * Forgetting a memory never removes the audit row; it transitions `status`
 * to "forgotten" and stamps `deletedAt`.
 */
export interface MemoryRefRepository {
  createMemoryRef(input: CreateMemoryRefInput): Promise<MemoryRefRecord>;
  getMemoryRefById(input: { id: string; tenantId: string }): Promise<MemoryRefRecord | null>;
  getMemoryRefByExternalRef(input: {
    tenantId: string;
    provider: string;
    externalRef: string;
  }): Promise<MemoryRefRecord | null>;
  updateMemoryRef(input: UpdateMemoryRefInput): Promise<MemoryRefRecord>;
  markMemoryRefForgotten(input: { id: string; tenantId: string }): Promise<MemoryRefRecord>;
}
