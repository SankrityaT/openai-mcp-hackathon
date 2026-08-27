import type { NextConfig } from "next";

/**
 * Cardea security headers.
 *
 * Everything here is derived from environment configuration so a
 * credential-less / companion-less deployment (fixture mode, `next dev`, a
 * preview build with no Supabase project yet) still gets a working,
 * self-consistent policy instead of an empty or broken one.
 *
 * ## Cross-origin WebMCP (Permissions-Policy tools)
 *
 * Cardea embeds exactly one companion origin, taken from
 * `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN`. `Permissions-Policy: tools`
 * delegates the WebMCP `tools` feature so the companion iframe's own
 * `allow="tools"` attribute is permitted to work. See
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools — the embedder
 * must delegate the `tools` permission for a cross-origin iframe to
 * register or expose WebMCP tools at all. When the env var is absent or
 * malformed this falls back to `'self'`: no companion is embeddable, and
 * the canvas shows its "companion not configured" state.
 *
 * ## Content-Security-Policy lives in src/proxy.ts, not here
 *
 * CSP now uses a per-request nonce on `script-src` (see `src/proxy.ts`),
 * which `next.config.ts`'s statically-evaluated `headers()` cannot produce
 * — it runs once, not per request. So `src/proxy.ts` is the single source
 * of truth for `Content-Security-Policy`: it builds the full policy
 * (including `frame-src` for the companion origin and `connect-src` for
 * Supabase) and sets it directly on both the forwarded request and the
 * response. Do not add a `Content-Security-Policy` entry back here —
 * shipping it from two places risks two independently-enforced policies
 * (browsers AND multiple CSP headers together) drifting out of sync.
 * `style-src` still carries `'unsafe-inline'` (React inline `style`
 * attributes); see the CSP-builder comment in `src/proxy.ts` and
 * `docs/SECURITY_REVIEW_BE08.md` finding 5 for why that one directive
 * remains as-is.
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
      // Content-Security-Policy is intentionally not set here — see the
      // module comment above. src/proxy.ts owns it (per-request nonce).
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
