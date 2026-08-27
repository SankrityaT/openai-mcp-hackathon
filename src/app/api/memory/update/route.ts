import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { updateUserMemory } from "@/harness/adapters/supermemory";
import { createAuthenticatedMemoryContext, translateMemoryRefError } from "../shared";

type UpdateBody = {
  memoryRefId: string;
  text?: string;
  influence?: string;
};

function boundedString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new ContractValidationError([`${path} must be between 1 and ${max} characters`]);
  }
  return value;
}

function parseUpdateBody(value: unknown): UpdateBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError(["body must be an object"]);
  }
  const input = value as Record<string, unknown>;
  const text = input.text === undefined ? undefined : boundedString(input.text, "body.text", 8_000);
  const influence =
    input.influence === undefined ? undefined : boundedString(input.influence, "body.influence", 1_000);
  if (text === undefined && influence === undefined) {
    throw new ContractValidationError(["body must include text and/or influence"]);
  }
  return { memoryRefId: parseUuid(input.memoryRefId, "body.memoryRefId"), text, influence };
}

/**
 * POST /api/memory/update
 *
 * Body: `{ memoryRefId, text?, influence? }` (at least one of `text` /
 * `influence` required)
 *
 * Edits a promoted memory's text and/or influence note in both systems and
 * bumps `memory_refs.version`. Refuses to edit a forgotten/deleted
 * reference — forgetting is terminal, not a soft pause.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("memory", readIpSignalHash(request));
    if (limited) return limited;

    const body = parseUpdateBody(await readBoundedJsonBody(request, 16_384));
    const { memoryRepository, userId, tenantId } = await createAuthenticatedMemoryContext();

    const existing = await memoryRepository.getMemoryRefById({ id: body.memoryRefId, tenantId });
    if (!existing) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    if (existing.status === "forgotten" || existing.status === "deleted") {
      return jsonResponse({ error: "memory_forgotten" }, { status: 409 });
    }

    const sourceLabel =
      typeof existing.source === "object" &&
      existing.source !== null &&
      !Array.isArray(existing.source) &&
      typeof (existing.source as Record<string, unknown>).source === "string"
        ? ((existing.source as Record<string, unknown>).source as string)
        : undefined;

    const result = await updateUserMemory({
      userId,
      externalRef: existing.externalRef,
      edit: { text: body.text, influence: body.influence },
      source: sourceLabel,
      contextCardId: existing.contextCardId ?? undefined,
      missionId: existing.missionId ?? undefined,
    });
    if (!result.available) {
      return jsonResponse(result);
    }

    const memoryRef = await memoryRepository.updateMemoryRef({
      id: existing.id,
      tenantId,
      version: existing.version + 1,
      influence: body.influence,
    });
    return jsonResponse({ available: true, memoryRef });
  } catch (error) {
    return safeHttpError(translateMemoryRefError(error));
  }
}
