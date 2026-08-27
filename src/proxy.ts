import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

/**
 * Per-request CSP nonce for `script-src`.
 *
 * This is the "real infrastructure work" the `next.config.ts` comment used
 * to call out of scope: `next.config.ts`'s `headers()` is evaluated once
 * (statically), so it cannot see a per-request value. `src/proxy.ts` is the
 * one place that runs on every request, so it is where Next.js's own CSP
 * nonce guide (content-security-policy.md, "Adding a nonce with Proxy")
 * says to mint the nonce and set the CSP header — on both the forwarded
 * request (so Next.js's SSR pipeline can auto-nonce framework-injected
 * inline scripts, and so `RootLayout` can read it back via
 * `headers()`) and the outgoing response (so the browser enforces it).
 *
 * Consequently `Content-Security-Policy` now has exactly one source of
 * truth: here, not `next.config.ts`. `next.config.ts` still owns every
 * other security header (`Permissions-Policy`, HSTS, etc.) since those
 * don't need a per-request value.
 *
 * `frame-src` / `connect-src` inputs (companion origin, Supabase project
 * origin) are re-derived here rather than imported from `next.config.ts`:
 * `next.config.ts` is loaded by Node before the app is built and isn't a
 * safe import target for app code, so keeping this a small, self-contained
 * duplicate is more robust than a cross-boundary import. Keep the origin
 * validation logic (`companionOrigin` below) in sync with its counterpart
 * in `next.config.ts` if either changes.
 */
function companionOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN?.trim();
  if (!raw || raw.includes("*")) return null;
  try {
    const url = new URL(raw);
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/** Supabase project origin in `https:` and `wss:` form, for `connect-src`. */
function supabaseConnectOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return [];
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

/**
 * Builds the nonce-based CSP. `script-src` drops `'unsafe-inline'` in favor
 * of `'nonce-<value>' 'strict-dynamic'`: the nonce covers Next's own
 * framework/RSC bootstrap scripts (applied automatically once Next.js sees
 * the nonce on the request's CSP header) plus the one explicit inline
 * script in `RootLayout`; `strict-dynamic` lets Next's dynamically
 * inserted chunk-loading scripts inherit trust from that nonce so they
 * don't need one each. `'unsafe-eval'` is dev-only (React's dev-mode stack
 * reconstruction uses `eval`; production never does).
 *
 * `style-src` intentionally keeps `'unsafe-inline'`: React renders
 * arbitrary, per-instance inline `style` attributes across the app, and
 * nonce-ing those would require CSS-in-JS-level integration Next.js does
 * not provide out of the box. This is the one remaining, documented
 * `'unsafe-inline'` — see `docs/SECURITY_REVIEW_BE08.md` finding 5.
 */
function buildContentSecurityPolicy(nonce: string, companion: string | null, isDev: boolean): string {
  const frameSrc = companion ? `'self' ${companion}` : "'self'";
  const connectSrc = ["'self'", ...supabaseConnectOrigins()].join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildContentSecurityPolicy(nonce, companionOrigin(), isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await refreshSupabaseSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
