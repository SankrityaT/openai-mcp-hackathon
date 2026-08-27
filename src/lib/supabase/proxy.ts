import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/core/database.types";

/**
 * True when both public Supabase credentials are present. Session refresh
 * reads `process.env` directly (rather than `getSupabasePublicConfig`, which
 * throws when either value is missing) so a credential-less deployment can
 * ask this cleanly instead of catching an exception on every request.
 */
export function hasSupabaseSessionConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Refreshes the Supabase session cookie for the current request.
 *
 * Without Supabase credentials there is no session to refresh: fixture mode
 * must serve with zero env (`next dev`/build previously threw here when
 * `NEXT_PUBLIC_SUPABASE_URL` was absent). This returns the request untouched
 * instead, truthfully degrading rather than fabricating a session.
 */
export async function refreshSupabaseSession(request: NextRequest) {
  if (!hasSupabaseSessionConfig()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        headers: Record<string, string>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
