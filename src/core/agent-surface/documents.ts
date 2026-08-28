/**
 * The markdown representations Cardea serves to agents.
 *
 * Every document is generated from `site.ts`, which the landing page and the
 * root layout's metadata also import, so the markdown an agent reads and the
 * HTML a person reads cannot drift apart.
 *
 * Pure string building, no framework imports, so the shapes are testable
 * directly. The `siteOrigin`-dependent absolute URLs are passed in rather than
 * read from the environment here, keeping this module deterministic.
 */

import {
  HERO_SUBHEAD,
  ISSUES_URL,
  PUBLIC_ROUTES,
  REPOSITORY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  STACK_DISCLOSURE,
  STACK_NOTE,
  WEBMCP_TOOLS,
  WHEN_NOT_TO_USE,
  WHEN_TO_USE,
  WORKING_STACK,
} from "./site";

/** Joins sections with exactly one blank line and a single trailing newline. */
function document(sections: readonly string[]): string {
  return `${sections.filter(Boolean).join("\n\n").trim()}\n`;
}

/**
 * The homepage, as markdown. Mirrors what the landing page states, in the
 * order it states it, so this is a representation of the same resource rather
 * than a second, differently-worded pitch.
 */
export function homepageMarkdown(origin: string): string {
  const stack = WORKING_STACK.map(
    (company) => `- **${company.name}** (${company.role}) — ${company.href}`,
  ).join("\n");

  return document([
    `# ${SITE_NAME}`,
    `> ${SITE_TAGLINE}`,
    SITE_DESCRIPTION,
    "## Turn any goal into a living workspace",
    HERO_SUBHEAD,
    `[Enter Cardea](${origin}/app)`,
    "## Cardea's working stack",
    "Built across the open web.",
    stack,
    STACK_NOTE,
    STACK_DISCLOSURE,
    "## More for agents",
    [
      `- Agent instructions and when to use Cardea: ${origin}/llms.txt`,
      `- Sitemap: ${origin}/sitemap.xml`,
      `- Privacy: ${origin}/privacy`,
      `- Terms: ${origin}/terms`,
      `- Source: ${REPOSITORY_URL}`,
    ].join("\n"),
  ]);
}

/**
 * `/llms.txt`, following the llmstxt.org layout: an H1 name, a blockquote
 * summary, prose, then link sections. The "When to use Cardea" and "How an
 * agent calls Cardea" sections are the agent-instruction guidance: concrete
 * jobs and the actual calling convention, not positioning copy.
 */
export function llmsTxt(origin: string): string {
  const whenToUse = WHEN_TO_USE.map((job) => `- ${job}`).join("\n");
  const whenNotToUse = WHEN_NOT_TO_USE.map((job) => `- ${job}`).join("\n");
  const tools = WEBMCP_TOOLS.map((tool) => `- \`${tool.name}\` — ${tool.description}`).join("\n");
  const pages = PUBLIC_ROUTES.map(
    (route) => `- [${route.title}](${origin}${route.path === "/" ? "" : route.path}): ${route.summary}`,
  ).join("\n");

  return document([
    `# ${SITE_NAME}`,
    `> ${SITE_DESCRIPTION}`,
    HERO_SUBHEAD,
    "## When to use Cardea",
    whenToUse,
    "## When not to use Cardea",
    whenNotToUse,
    "## How an agent calls Cardea",
    [
      "Cardea has no public agent HTTP API. It is driven in the browser through WebMCP.",
      "",
      `Open \`${origin}/app\` in a WebMCP-capable browser as a signed-in person. Cardea registers these tools on the page:`,
      "",
      tools,
      "",
      "Every tool acts on the visible canvas, and any consequential action stops at an approval the person resolves there. An agent cannot approve on the person's behalf.",
    ].join("\n"),
    "## Pages",
    pages,
    "## Optional",
    [
      `- [Source repository](${REPOSITORY_URL}): the full implementation, open source.`,
      `- [Issues](${ISSUES_URL}): where to report a problem or request data removal.`,
    ].join("\n"),
  ]);
}

/**
 * The body of a 404, as markdown. Served both as the markdown representation
 * and, rendered, as the visible page: an agent that lands on a dead URL needs
 * to know where the real ones are, not just that this one is gone.
 */
export function notFoundMarkdown(origin: string): string {
  const pages = PUBLIC_ROUTES.map(
    (route) => `- [${route.title}](${origin}${route.path === "/" ? "" : route.path}): ${route.summary}`,
  ).join("\n");

  return document([
    "# 404 Not Found",
    `There is no page at this URL on ${SITE_NAME}.`,
    "## Where to look next",
    pages,
    [
      `- [Agent instructions](${origin}/llms.txt): what Cardea is for and how to call it.`,
      `- [Sitemap](${origin}/sitemap.xml): every indexable URL.`,
    ].join("\n"),
  ]);
}
