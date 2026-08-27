import type { NextConfig } from "next";

/**
 * Cross-origin WebMCP header policy.
 *
 * Cardea embeds exactly one companion origin, taken from
 * `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN`. Two headers are derived from it:
 *
 * - `Content-Security-Policy: frame-src` restricts which origins Cardea may embed at all. Only
 *   `frame-src` is declared here so this stays additive: it does not impose a script or style
 *   policy on Next.js, which would require nonce plumbing that is out of scope for this change.
 * - `Permissions-Policy: tools` delegates the WebMCP `tools` feature. The iframe still needs its
 *   own `allow="tools"` attribute; the header is what permits that delegation to succeed.
 *
 * When the env var is absent or malformed, both headers fall back to `'self'`, no companion is
 * embeddable, and the canvas shows its "companion not configured" state.
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

const nextConfig: NextConfig = {
  async headers() {
    const companion = companionOrigin();
    const frameSrc = companion ? `'self' ${companion}` : "'self'";
    const tools = companion ? `tools=(self "${companion}")` : "tools=(self)";

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-src ${frameSrc}` },
          { key: "Permissions-Policy", value: tools },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
