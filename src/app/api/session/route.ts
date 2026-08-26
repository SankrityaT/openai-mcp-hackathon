import { jsonResponse } from "@/core/server/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return jsonResponse({ authenticated: false });
  }
  return jsonResponse({ authenticated: true, userId });
}
