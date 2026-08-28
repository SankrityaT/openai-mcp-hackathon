import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";
import { homepageMarkdown } from "@/core/agent-surface/documents";
import { siteOrigin } from "@/core/agent-surface/site";
import { NOT_ACCEPTABLE, negotiateMediaType } from "@/core/agent-surface/negotiation";

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
 * The app's own origin in `ws:`/`wss:` form, for `connect-src`.
 *
 * CSP3 says `'self'` already covers a same-origin WebSocket, and Chrome
 * implements that. Safari has historically not, and blocks `wss://` against a
 * `connect-src 'self'` policy, which would silently kill the remote browser
 * node on one browser only. Naming the scheme explicitly costs nothing and is
 * not a widening: it is the same origin, spelled twice.
 *
 * Derived from the request `Host` rather than an env var so preview
 * deployments and localhost are correct without configuration. Dev is plain
 * http, so it gets `ws:`; everything else gets `wss:`.
 */
function selfWebSocketOrigin(host: string | null, isDev: boolean): string | null {
  if (!host) return null;
  // A Host header is attacker-controlled in principle. Only ever emit it into
  // the policy when it is a plausible authority, never with a stray delimiter.
  if (!/^[A-Za-z0-9.\-[\]]+(:\d{1,5})?$/.test(host)) return null;
  return `${isDev ? "ws" : "wss"}://${host}`;
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
function buildContentSecurityPolicy(
  nonce: string,
  companion: string | null,
  isDev: boolean,
  host: string | null,
): string {
  const frameSrc = companion ? `'self' ${companion}` : "'self'";
  const selfWs = selfWebSocketOrigin(host, isDev);
  const connectSrc = ["'self'", ...(selfWs ? [selfWs] : []), ...supabaseConnectOrigins()].join(" ");

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

/**
 * Paths that have a markdown representation, mapped to the builder for it.
 *
 * Deliberately tiny. A markdown representation must say the same thing as the
 * HTML at the same URL, so a path only belongs here once its markdown is
 * generated from the same source as the page (see
 * `src/core/agent-surface/documents.ts`). `/privacy` and `/terms` are
 * intentionally absent: a hand-maintained second copy of a legal document is a
 * correctness hazard, not a feature.
 */
const MARKDOWN_REPRESENTATIONS: ReadonlyMap<string, (origin: string) => string> = new Map([
  ["/", homepageMarkdown],
]);

/** Server preference order. HTML first, so browsers are unaffected. */
const OFFERED_MEDIA_TYPES = ["text/html", "text/markdown"] as const;

/**
 * True for Next.js's own navigation and prefetch fetches.
 *
 * These carry `Accept: text/x-component`, which content negotiation would
 * correctly judge unacceptable and answer with a 406 — breaking client-side
 * routing across the entire app. They are framework transport for a page this
 * proxy has already decided to serve, not a client expressing a preference, so
 * negotiation must not run on them at all.
 */
function isFrameworkNavigation(request: NextRequest): boolean {
  return (
    request.headers.has("rsc") ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-state-tree") ||
    (request.headers.get("accept")?.includes("text/x-component") ?? false)
  );
}

/** Headers every directly-returned (non-app) response still needs. */
function negotiatedHeaders(contentType: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    // Without this, a shared cache can hand the HTML variant to an agent
    // asking for markdown, or the reverse, depending on which landed first.
    Vary: "Accept, Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600, must-revalidate",
  });
}

export async function proxy(request: NextRequest) {
  // Content negotiation runs before session refresh: an agent asking for
  // markdown is not carrying a session, and the markdown representation is
  // identical for everyone, so there is nothing to refresh for it.
  const markdownFor = MARKDOWN_REPRESENTATIONS.get(request.nextUrl.pathname);
  const negotiable = Boolean(markdownFor) && !isFrameworkNavigation(request);

  if (negotiable) {
    const chosen = negotiateMediaType(request.headers.get("accept"), OFFERED_MEDIA_TYPES);
    if (chosen === NOT_ACCEPTABLE) {
      return new Response("Not Acceptable\n\nThis URL can be served as text/html or text/markdown.\n", {
        status: 406,
        headers: negotiatedHeaders("text/plain; charset=utf-8"),
      });
    }
    if (chosen === "text/markdown") {
      return new Response(markdownFor!(siteOrigin()), {
        status: 200,
        headers: negotiatedHeaders("text/markdown; charset=utf-8"),
      });
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildContentSecurityPolicy(
    nonce,
    companionOrigin(),
    isDev,
    request.headers.get("host"),
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await refreshSupabaseSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  // Note: `Vary: Accept` for the HTML branch of a negotiated URL is NOT set
  // here. Next.js recomputes `Vary` for a page render after middleware runs
  // (to add its own `rsc` / router-state entries), discarding anything set or
  // appended at this layer — verified empirically against `next start`. The
  // same is true of `next.config.ts`'s `headers()`. It is therefore set one
  // layer up, in `vercel.json`, which the CDN applies to the finished
  // response. The markdown and 406 branches above set their own `Vary`
  // directly, because those responses never reach the page renderer.
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
