import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "./_legal/legal-shell";
import { PUBLIC_ROUTES } from "@/core/agent-surface/site";

export const metadata: Metadata = {
  title: "404 Not Found | Cardea",
  description: "There is no page at this URL on Cardea. Here is where to look next.",
  robots: { index: false, follow: true },
};

/**
 * The 404, written so both a person and an agent can recover from it.
 *
 * A bare "page not found" tells an agent only that it failed. Naming the real
 * public routes, plus the machine-readable index at `/llms.txt` and the
 * sitemap, turns a dead end into a redirect it can follow itself. The same
 * recovery map is served as markdown by `notFoundMarkdown` in
 * `src/core/agent-surface/documents.ts`, from the same `PUBLIC_ROUTES` list, so
 * the two cannot disagree.
 *
 * Next.js serves this file with a real HTTP 404 status; it never returns 200
 * with an app shell.
 */
export default function NotFound() {
  return (
    <LegalShell title="404 Not Found">
      <p>There is no page at this URL on Cardea.</p>

      <h2>Where to look next</h2>
      <ul>
        {PUBLIC_ROUTES.map((route) => (
          <li key={route.path}>
            <Link href={route.path}>{route.title}</Link>: {route.summary}
          </li>
        ))}
        <li>
          <a href="/llms.txt">Agent instructions</a>: what Cardea is for and how to call it.
        </li>
        <li>
          <a href="/sitemap.xml">Sitemap</a>: every indexable URL.
        </li>
      </ul>
    </LegalShell>
  );
}
