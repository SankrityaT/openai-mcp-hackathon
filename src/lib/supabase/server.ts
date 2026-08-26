import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/core/database.types";
import { getSupabasePublicConfig } from "./public-env";
import { getSupabaseSecretKey } from "./secret-env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicConfig();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. src/proxy.ts refreshes them.
        }
      },
    },
  });
}

export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const { url } = getSupabasePublicConfig();
  return createClient<Database>(url, getSupabaseSecretKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }) as SupabaseClient<Database>;
}
