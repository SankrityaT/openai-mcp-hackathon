import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/agent-surface/site";

/**
 * Crawlers are welcome on the public pages and kept out of the surfaces that
 * can only answer them with a redirect or a 401: the signed-in canvas, the
 * auth callback, and the API. This is a crawl-budget statement, not a security
 * boundary — those routes enforce their own authorization.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/app", "/canvas", "/settings/", "/auth/", "/signin"],
    },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
