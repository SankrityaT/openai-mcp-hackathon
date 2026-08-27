import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { forgetUserMemory } from "@/harness/adapters/supermemory";
import { createAuthenticatedMemoryContext, translateMemoryRefError } from "../shared";

function parseForgetBody(value: unknown): { memoryRefId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError(["body must be an object"]);
  }
  const input = value as Record<string, unknown>;
  return { memoryRefId: parseUuid(input.memoryRefId, "body.memoryRefId") };
}

/**
 * POST /api/memory/forget
 *
 * Body: `{ memoryRefId }`
 *
 * Deletes the memory in Supermemory and marks the paired `memory_refs` row
 * `status: "forgotten"` with `deletedAt` set — it is never hard-deleted, so
 * the audit trail survives. Idempotent: forgetting an already-forgotten
 * reference is a no-op that returns the current row without calling the
 * provider again. If the provider delete fails, the local row is left
 * untouched (never marked forgotten) so a retry can safely try again.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("memory", readIpSignalHash(request));
    if (limited) return limited;

    const body = parseForgetBody(await readBoundedJsonBody(request, 8_192));
    const { memoryRepository, tenantId } = await createAuthenticatedMemoryContext();

    const existing = await memoryRepository.getMemoryRefById({ id: body.memoryRefId, tenantId });
    if (!existing) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    if (existing.status === "forgotten" || existing.status === "deleted") {
      return jsonResponse({ available: true, memoryRef: existing, idempotentReplay: true });
    }

    const result = await forgetUserMemory(existing.externalRef);
    if (!result.available) {
      return jsonResponse(result);
    }

    const memoryRef = await memoryRepository.markMemoryRefForgotten({ id: existing.id, tenantId });
    return jsonResponse({ available: true, memoryRef });
  } catch (error) {
    return safeHttpError(translateMemoryRefError(error));
  }
}
