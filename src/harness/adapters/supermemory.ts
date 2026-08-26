import "server-only";

import Supermemory from "supermemory";

function client() {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  return apiKey ? new Supermemory({ apiKey }) : null;
}

function containerTag(userId: string) {
  const normalized = userId.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 90);
  if (!normalized) throw new Error("Invalid memory owner");
  return `user:${normalized}`;
}

export type MemoryProposal = {
  text: string;
  source: string;
  influence: string;
  contextCardId?: string;
  missionId?: string;
};

export async function searchUserMemory(input: {
  userId: string;
  query: string;
  contextCardId?: string;
  limit?: number;
}) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, memories: [] };
  const response = await supermemory.search({
    q: input.query.slice(0, 2_000),
    containerTag: containerTag(input.userId),
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
  userId: string;
  proposal: MemoryProposal;
  customId: string;
}) {
  const supermemory = client();
  if (!supermemory) return { available: false as const, reason: "not_configured" as const };
  const response = await supermemory.add({
    content: input.proposal.text.slice(0, 8_000),
    containerTag: containerTag(input.userId),
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
