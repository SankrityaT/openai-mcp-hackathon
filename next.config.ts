import type { NextConfig } from "next";

/**
 * Cardea security headers.
 *
 * Everything here is derived from environment configuration so a
 * credential-less / companion-less deployment (fixture mode, `next dev`, a
 * preview build with no Supabase project yet) still gets a working,
 * self-consistent policy instead of an empty or broken one.
 *
 * ## Cross-origin WebMCP (frame-src / Permissions-Policy tools)
 *
 * Cardea embeds exactly one companion origin, taken from
 * `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN`:
 *
 * - CSP `frame-src` restricts which origins Cardea may embed at all.
 * - `Permissions-Policy: tools` delegates the WebMCP `tools` feature so the
 *   companion iframe's own `allow="tools"` attribute is permitted to work.
 *   See https://developer.chrome.com/docs/ai/webmcp/secure-tools — the
 *   embedder must delegate the `tools` permission for a cross-origin iframe
 *   to register or expose WebMCP tools at all.
 *
 * When the env var is absent or malformed, both fall back to `'self'`: no
 * companion is embeddable, and the canvas shows its "companion not
 * configured" state.
 *
 * ## CSP script/style strategy (known gap)
 *
 * Next.js App Router ships small inline bootstrap scripts (the RSC payload
 * push scripts, `__NEXT_DATA__`) and React can render inline `style`
 * attributes. A byte-for-byte strict CSP for those needs per-request nonce
 * plumbing: the nonce would have to be minted in `src/proxy.ts` (the one
 * place that already runs per request) and threaded through
 * `next.config.ts`'s statically-evaluated `headers()`, which cannot see a
 * per-request value. That is real infrastructure work out of this slice's
 * scope (`src/proxy.ts`'s only owned job here is the Supabase session
 * refresh fix below). Until that lands, `script-src` and `style-src` keep
 * `'unsafe-inline'` — every other directive (`frame-src`, `connect-src`,
 * `frame-ancestors`, `object-src`, `base-uri`) is fully locked down. This is
 * documented, not silently shipped.
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

/**
 * The Supabase project origin, in both `https:` (REST/Auth) and `wss:`
 * (Realtime) form, for `connect-src`. Absent or malformed configuration
 * degrades to no additional `connect-src` entries: fixture mode never needs
 * to reach Supabase at all.
 */
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

function buildContentSecurityPolicy(companion: string | null): string {
  const frameSrc = companion ? `'self' ${companion}` : "'self'";
  const connectSrc = ["'self'", ...supabaseConnectOrigins()].join(" ");

  return [
    "default-src 'self'",
    // Known gap: no nonce infrastructure yet. See module comment above.
    "script-src 'self' 'unsafe-inline'",
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
 * Least-privilege Permissions-Policy. Cardea uses none of camera,
 * microphone, geolocation, payment, or device-sensor APIs, so every feature
 * except the WebMCP `tools` delegation is fully denied (including to same
 * origin) rather than merely left at the browser default.
 */
function buildPermissionsPolicy(companion: string | null): string {
  const toolsAllowlist = companion ? `self "${companion}"` : "self";
  return [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=()",
    "magnetometer=()",
    "gyroscope=()",
    "accelerometer=()",
    `tools=(${toolsAllowlist})`,
  ].join(", ");
}

const nextConfig: NextConfig = {
  async headers() {
    const companion = companionOrigin();
    const isProduction = process.env.NODE_ENV === "production";

    const headers: { key: string; value: string }[] = [
      { key: "Content-Security-Policy", value: buildContentSecurityPolicy(companion) },
      { key: "Permissions-Policy", value: buildPermissionsPolicy(companion) },
      { key: "Origin-Agent-Cluster", value: "?1" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];

    // HSTS only on production: it is a long-lived, cache-like browser
    // instruction that would otherwise pin `localhost`/preview HTTP origins.
    if (isProduction) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
