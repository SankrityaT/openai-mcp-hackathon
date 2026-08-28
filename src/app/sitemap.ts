import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, siteUrl } from "@/core/agent-surface/site";

/**
 * Only genuinely indexable, public URLs belong here. `/app`, `/canvas`,
 * `/settings`, `/signin`, `/auth`, and every `/api` route are either
 * auth-gated or machine endpoints, so listing them would advertise URLs a
 * crawler can only be refused by.
 *
 * `lastModified` is the build time, which is the honest answer for a site
 * whose pages ship with the deployment.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: siteUrl(route.path),
    lastModified,
    changeFrequency: route.path === "/" ? ("weekly" as const) : ("monthly" as const),
    priority: route.path === "/" ? 1 : 0.5,
  }));
}
