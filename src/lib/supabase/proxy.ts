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
 *
 * `requestHeaders`, when provided, replaces `request.headers` on every
 * `NextResponse.next({ request: { headers } })` call this function makes.
 * `src/proxy.ts` (the caller) uses this to thread its per-request CSP
 * nonce (`x-nonce` / `Content-Security-Policy`) through session refresh:
 * those headers must reach the forwarded *request* — not just the response
 * — because Next.js reads the nonce from the request headers of the page
 * render that follows, and `RootLayout` reads `x-nonce` via
 * `headers()`. Defaulting to `request.headers` keeps this function's
 * behavior unchanged for any other caller (e.g. tests) that omits it.
 */
export async function refreshSupabaseSession(request: NextRequest, requestHeaders?: Headers) {
  const headers = requestHeaders ?? request.headers;

  if (!hasSupabaseSessionConfig()) {
    return NextResponse.next({ request: { headers } });
  }

  let response = NextResponse.next({ request: { headers } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        responseHeaders: Record<string, string>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(responseHeaders)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
