import { createComposioReadSession } from "@/harness/adapters/composio";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    return jsonResponse(await createComposioReadSession(userId));
  } catch (error) {
    return safeHttpError(error);
  }
}
