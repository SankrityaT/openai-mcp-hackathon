import "server-only";

import Supermemory from "supermemory";

function client() {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  // Bounded on purpose. Memory is optional planning context, and the SDK's
  // defaults are a 60 second timeout with two retries that also retry on
  // timeout, so a stalled service could hold the planning step for around
  // three minutes before the mission moved at all. Eight seconds with no
  // retry means a slow memory service costs at most that, and planning goes
  // on with whatever it had, which is the honest fallback the caller already
  // handles.
  return apiKey ? new Supermemory({ apiKey, timeout: 8_000, maxRetries: 0 }) : null;
}

/**
 * Scoped by tenant, not by user. Every other part of persistence (the
 * mission repository, the `memory_refs` table) authorizes by `tenantId`;
 * this used to key on `userId` instead, a different identifier that only
 * ever produced the same isolation because `ensureUserTenant()` currently
 * guarantees exactly one tenant per user. That guarantee lives entirely in
 * that one RPC, not here, so keying on the same identifier the rest of the
 * system actually authorizes by is the boundary that stays correct even if
 * that guarantee ever changes.
 */
function containerTag(tenantId: string) {
  const normalized = tenantId.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 90);
  if (!normalized) throw new Error("Invalid memory owner");
  return `tenant:${normalized}`;
}

export type MemoryProposal = {
  text: string;
  source: string;
  influence: string;
  contextCardId?: string;
  missionId?: string;
};

export async function searchUserMemory(input: {
  tenantId: string;
  query: string;
  contextCardId?: string;
  limit?: number;
}) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, memories: [] };
  const response = await supermemory.search({
    q: input.query.slice(0, 2_000),
    containerTag: containerTag(input.tenantId),
    searchMode: "memories",
    threshold: 0.65,
    limit: Math.min(Math.max(input.limit ?? 8, 2), 20),
    rerank: false,
    rewriteQuery: false,
    filters: input.contextCardId
      ? { AND: [{ key: "contextCardId", value: input.contextCardId }] }
      : undefined,
  });
  return {
    available: true as const,
    memories: response.results.map((result) => ({
      id: result.id,
      text: result.memory ?? result.chunk ?? "",
      similarity: result.similarity,
      version: result.version,
      metadata: result.metadata,
    })),
  };
}

export async function promoteUserMemory(input: {
  tenantId: string;
  proposal: MemoryProposal;
  customId: string;
}) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, reason: "not_configured" as const };
  const response = await supermemory.add({
    content: input.proposal.text.slice(0, 8_000),
    containerTag: containerTag(input.tenantId),
    customId: input.customId.slice(0, 100),
    metadata: {
      source: input.proposal.source.slice(0, 500),
      influence: input.proposal.influence.slice(0, 1_000),
      ...(input.proposal.contextCardId ? { contextCardId: input.proposal.contextCardId } : {}),
      ...(input.proposal.missionId ? { missionId: input.proposal.missionId } : {}),
      consent: "explicit",
    },
    taskType: "memory",
  });
  return { available: true as const, id: response.id, status: response.status };
}

export async function forgetUserMemory(memoryId: string) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, reason: "not_configured" as const };
  await supermemory.documents.delete(memoryId);
  return { available: true as const, deleted: true as const };
}

export type MemoryEdit = {
  text?: string;
  influence?: string;
};

/**
 * Edits a promoted memory's text and/or influence note in place. The caller
 * is responsible for bumping the paired `memory_refs.version` column; this
 * only updates the Supermemory-side document.
 */
export async function updateUserMemory(input: {
  tenantId: string;
  externalRef: string;
  edit: MemoryEdit;
  source?: string;
  contextCardId?: string;
  missionId?: string;
}) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, reason: "not_configured" as const };
  const metadata: Record<string, string> = { consent: "explicit" };
  if (input.edit.influence !== undefined) metadata.influence = input.edit.influence.slice(0, 1_000);
  if (input.source !== undefined) metadata.source = input.source.slice(0, 500);
  if (input.contextCardId !== undefined) metadata.contextCardId = input.contextCardId;
  if (input.missionId !== undefined) metadata.missionId = input.missionId;
  const response = await supermemory.documents.update(input.externalRef, {
    containerTag: containerTag(input.tenantId),
    ...(input.edit.text !== undefined ? { content: input.edit.text.slice(0, 8_000) } : {}),
    metadata,
    taskType: "memory",
  });
  return { available: true as const, id: response.id, status: response.status };
}
