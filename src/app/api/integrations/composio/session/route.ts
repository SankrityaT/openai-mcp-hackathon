import { createComposioReadSession } from "@/harness/adapters/composio";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jsonResponse, safeHttpError } from "@/core/server/http";

export async function POST() {
  try {
    const client = await createSupabaseServerClient();
    const { userId } = await requireAuthenticatedUser(client);
    return jsonResponse(await createComposioReadSession(userId));
  } catch (error) {
    return safeHttpError(error);
  }
}
