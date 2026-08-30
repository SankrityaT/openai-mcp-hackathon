import type { ContextMemory } from "../contracts";
import type { searchUserMemory } from "./supermemory";

const SUMMARY_BYTE_CAP = 600;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

export type RetrievedMemoryItem = ContextMemory & {
  provenance: string;
  source: string;
  externalRef: string;
};

export type MemorySearchFn = typeof searchUserMemory;

export type RetrieveMemoryForContextInput = {
  tenantId: string;
  query: string;
  selectedContextCardIds: string[];
  limit?: number;
};

function boundedSummary(text: string): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= SUMMARY_BYTE_CAP) return text;
  return `${buffer.subarray(0, SUMMARY_BYTE_CAP).toString("utf8")}…`;
}

function metadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Retrieves Supermemory results shaped for the context compiler's
 * `PlanningInput.memories` input (`ContextMemory[]`), plus provenance for
 * the sticky-note memory UI. Bounded, provenance-tagged, and defensively
 * excludes any memory tied to a context card the caller did not select —
 * the context compiler re-applies the same filter, but untrusted retrieval
 * content must never depend on a single enforcement point.
 *
 * The real `searchUserMemory` import is deferred to call time (rather than
 * a static top-level import) so this module — and its unit tests — never
 * have to load the Supermemory SDK unless a live search actually runs.
 */
export async function retrieveMemoryForContext(
  input: RetrieveMemoryForContextInput,
  deps: { search?: MemorySearchFn } = {},
): Promise<{ available: boolean; items: RetrievedMemoryItem[] }> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const selected = new Set(input.selectedContextCardIds);
  const search = deps.search ?? (await import("./supermemory")).searchUserMemory;

  let result: Awaited<ReturnType<MemorySearchFn>>;
  try {
    result = await search({ tenantId: input.tenantId, query: input.query, limit });
  } catch {
    return { available: false, items: [] };
  }
  if (!result.available) return { available: false, items: [] };

  const items: RetrievedMemoryItem[] = result.memories
    .map((memory) => {
      const contextCardId = metadataString(memory.metadata, "contextCardId");
      return {
        id: memory.id,
        summary: boundedSummary(memory.text),
        contextCardId,
        relevance: memory.similarity ?? 0,
        provenance: "supermemory",
        source: metadataString(memory.metadata, "source") ?? "unknown",
        externalRef: memory.id,
      };
    })
    .filter((item) => !item.contextCardId || selected.has(item.contextCardId))
    .slice(0, limit);

  return { available: true, items };
}
