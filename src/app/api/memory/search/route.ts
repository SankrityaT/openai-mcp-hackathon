import { readBoundedJsonBody } from "@/core/contracts/commands";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { searchUserMemory } from "@/harness/adapters/supermemory";
import { createAuthenticatedMemoryContext, translateMemoryRefError } from "../shared";

/**
 * POST /api/memory/search
 *
 * Body: `{ query, contextCardId? }`
 *
 * Hardened over the original search-only route: each Supermemory result is
 * cross-referenced against its `memory_refs` audit row (when one exists) so
 * the UI can surface source + influence alongside the raw search hit,
 * without ever trusting the provider's response as the record of consent.
 * A result with no matching `memory_refs` row (e.g. content Supermemory
 * indexed outside the explicit promote flow) is still returned, just
 * without a `memoryRef` attachment — search itself never blocks on this
 * lookup failing for one item.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("memory", readIpSignalHash(request));
    if (limited) return limited;

    const body = (await readBoundedJsonBody(request, 16_384)) as Record<string, unknown>;
    if (typeof body.query !== "string" || body.query.length < 1 || body.query.length > 2_000) {
      return jsonResponse({ error: "invalid_request" }, { status: 400 });
    }
    const { memoryRepository, tenantId } = await createAuthenticatedMemoryContext();
    const result = await searchUserMemory({
      tenantId,
      query: body.query,
      contextCardId: typeof body.contextCardId === "string" ? body.contextCardId : undefined,
    });
    if (!result.available) {
      return jsonResponse(result);
    }

    const memories = await Promise.all(
      result.memories.map(async (memory) => {
        try {
          const memoryRef = await memoryRepository.getMemoryRefByExternalRef({
            tenantId,
            provider: "supermemory",
            externalRef: memory.id,
          });
          return { ...memory, memoryRef: memoryRef && memoryRef.status === "promoted" ? memoryRef : null };
        } catch {
          return { ...memory, memoryRef: null };
        }
      }),
    );

    return jsonResponse({ available: true, memories });
  } catch (error) {
    return safeHttpError(translateMemoryRefError(error));
  }
}
