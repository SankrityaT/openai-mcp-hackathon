import { createHash } from "node:crypto";
import { readBoundedJsonBody } from "@/core/contracts/commands";
import { ContractValidationError, parseUuid } from "@/core/contracts/validation";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { MemoryRefDatabaseError } from "@/core/server/memory-ref-repository";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { promoteUserMemory } from "@/harness/adapters/supermemory";
import { createAuthenticatedMemoryContext, translateMemoryRefError } from "../shared";

type PromoteBody = {
  text: string;
  source: string;
  influence: string;
  contextCardId?: string;
  missionId?: string;
  idempotencyKey?: string;
};

function boundedString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new ContractValidationError([`${path} must be between 1 and ${max} characters`]);
  }
  return value;
}

function parsePromoteBody(value: unknown): PromoteBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractValidationError(["body must be an object"]);
  }
  const input = value as Record<string, unknown>;
  return {
    text: boundedString(input.text, "body.text", 8_000),
    source: boundedString(input.source, "body.source", 500),
    influence: boundedString(input.influence, "body.influence", 1_000),
    contextCardId:
      input.contextCardId === undefined ? undefined : parseUuid(input.contextCardId, "body.contextCardId"),
    missionId: input.missionId === undefined ? undefined : parseUuid(input.missionId, "body.missionId"),
    idempotencyKey:
      input.idempotencyKey === undefined ? undefined : boundedString(input.idempotencyKey, "body.idempotencyKey", 100),
  };
}

function deriveCustomId(userId: string, body: PromoteBody): string {
  const basis = `${userId}:${body.text}:${body.source}:${body.contextCardId ?? ""}:${body.missionId ?? ""}`;
  return `mem-${createHash("sha256").update(basis).digest("hex").slice(0, 40)}`;
}

/**
 * POST /api/memory/promote
 *
 * Body: `{ text, source, influence, contextCardId?, missionId?, idempotencyKey? }`
 *
 * Explicit-consent promotion: calls Supermemory and persists the paired
 * `memory_refs` audit row in one request. Idempotent via the provider
 * document id: a deterministic `customId` (or a caller-supplied
 * `idempotencyKey`) makes Supermemory resolve a replayed proposal to the
 * same document, whose id is what the audit row stores as `externalRef`, so
 * an exact replay returns the existing reference instead of duplicating it.
 * A memory that was previously forgotten is never silently resurrected: its
 * row stays terminal and a replay is answered with a conflict.
 */
export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("memory", readIpSignalHash(request));
    if (limited) return limited;

    const body = parsePromoteBody(await readBoundedJsonBody(request, 32_768));
    const { memoryRepository, userId, tenantId } = await createAuthenticatedMemoryContext();

    const customId = body.idempotencyKey ?? deriveCustomId(userId, body);
    const promotion = await promoteUserMemory({
      tenantId,
      proposal: {
        text: body.text,
        source: body.source,
        influence: body.influence,
        contextCardId: body.contextCardId,
        missionId: body.missionId,
      },
      customId,
    });
    if (!promotion.available) {
      return jsonResponse(promotion);
    }

    // The audit row stores the provider's document id as `externalRef` (see
    // createMemoryRef below), never the derived customId, so replay
    // detection must key on `promotion.id`: a replayed proposal resolves to
    // the same provider document and finds the row minted the first time.
    const existing = await memoryRepository.getMemoryRefByExternalRef({
      tenantId,
      provider: "supermemory",
      externalRef: promotion.id,
    });
    if (existing) {
      if (existing.status === "promoted") {
        return jsonResponse({ available: true, memoryRef: existing, idempotentReplay: true });
      }
      // A forgotten (or otherwise settled) row is terminal and must not be
      // resurrected by minting a duplicate. Answer with the same translated
      // unique-constraint conflict the insert below would raise.
      return safeHttpError(translateMemoryRefError(new MemoryRefDatabaseError("23505")));
    }

    const memoryRef = await memoryRepository.createMemoryRef({
      tenantId,
      missionId: body.missionId,
      contextCardId: body.contextCardId,
      provider: "supermemory",
      externalRef: promotion.id,
      version: 1,
      source: { source: body.source },
      influence: body.influence,
      status: "promoted",
      promotedBy: userId,
    });

    return jsonResponse({ available: true, memoryRef }, { status: 201 });
  } catch (error) {
    return safeHttpError(translateMemoryRefError(error));
  }
}
