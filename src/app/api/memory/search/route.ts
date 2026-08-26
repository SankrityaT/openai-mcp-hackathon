import { readBoundedJsonBody } from "@/core/contracts/commands";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { searchUserMemory } from "@/harness/adapters/supermemory";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = (await readBoundedJsonBody(request, 16_384)) as Record<string, unknown>;
    if (typeof body.query !== "string" || body.query.length < 1 || body.query.length > 2_000) {
      return jsonResponse({ error: "invalid_request" }, { status: 400 });
    }
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    return jsonResponse(await searchUserMemory({
      userId,
      query: body.query,
      contextCardId: typeof body.contextCardId === "string" ? body.contextCardId : undefined,
    }));
  } catch (error) {
    return safeHttpError(error);
  }
}
