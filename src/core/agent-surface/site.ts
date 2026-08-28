/**
 * The canonical, machine-readable facts about Cardea.
 *
 * This module is the single source of truth for every surface that describes
 * the product to something that is not a person: JSON-LD on the homepage,
 * `/llms.txt`, `/sitemap.xml`, `/robots.txt`, and the `text/markdown`
 * representation served by content negotiation. The landing page and the root
 * layout's metadata import the same strings, so a copy change lands in all of
 * them at once instead of leaving the agent-facing surfaces quietly stale.
 *
 * Everything here must be literally true of the deployed product. These
 * strings are read by systems that cannot check them, so an aspirational
 * claim here is a fabricated one.
 */

export const SITE_NAME = "Cardea";

export const SITE_TAGLINE = "Your Canvas Beyond the Prompt";

export const SITE_DESCRIPTION =
  "Cardea turns complex goals into living workspaces where you can watch, steer, and approve coordinated work across the web.";

/** The hero subhead, rendered on the landing page and mirrored in markdown. */
export const HERO_SUBHEAD =
  "Cardea plans, browses, researches, and acts across the web while you watch, steer, and approve the work in real time.";

export const STACK_NOTE =
  "WebMCP is the public doorway. These systems provide the browser, deployment, durable work, connected apps, and memory behind it, so Cardea acts on the real web instead of a simulation of it.";

export const STACK_DISCLOSURE =
  "Cloudflare and Shopify remain documented extensions, not live Cardea integrations.";

export const REPOSITORY_URL = "https://github.com/SankrityaT/openai-mcp-hackathon";

export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/**
 * The stack shown on the landing page. Shared with the markdown and llms.txt
 * representations so the three lists cannot disagree.
 */
export const WORKING_STACK = [
  { name: "OpenAI", slug: "openai", role: "Agent runtime", href: "https://openai.com/" },
  {
    name: "Chrome",
    slug: "chrome",
    role: "WebMCP browser",
    href: "https://developer.chrome.com/docs/ai/webmcp",
  },
  { name: "Vercel", slug: "vercel", role: "Deployment", href: "https://vercel.com/" },
  {
    name: "Supabase",
    slug: "supabase",
    role: "Auth + mission state",
    href: "https://supabase.com/",
  },
  {
    name: "Inngest",
    slug: "inngest",
    role: "Durable orchestration",
    href: "https://www.inngest.com/",
  },
  { name: "Composio", slug: "composio", role: "Connected apps", href: "https://composio.dev/" },
  {
    name: "supermemory",
    slug: "supermemory",
    role: "Long-term memory",
    href: "https://supermemory.ai/",
  },
] as const;

/**
 * The WebMCP tools Cardea registers on its canvas page, named exactly as
 * `src/webmcp/use-cardea-webmcp.ts` registers them. This is the "how an agent
 * should call you" guidance: an agent in a WebMCP-capable browser discovers
 * these on the page rather than through an HTTP API, because Cardea has no
 * public agent API and inventing one here would be a lie.
 */
export const WEBMCP_TOOLS = [
  {
    name: "create_mission",
    description:
      "Create a draft Cardea mission from a user goal and open its visible mandate for review.",
  },
  {
    name: "inspect_canvas",
    description:
      "Read a bounded summary of the visible Cardea mission, nodes, states, and pending decisions.",
  },
  {
    name: "update_mandate",
    description: "Propose a bounded change to the visible Cardea mandate for the user to review.",
  },
  {
    name: "focus_node",
    description:
      "Focus one existing Cardea node in the visible canvas without changing mission state.",
  },
  {
    name: "redirect_node",
    description:
      "Add a scoped user instruction to an existing Cardea node and open the visible composer.",
  },
  {
    name: "set_node_state",
    description: "Pause, resume, retry, or revert one Cardea node through validated visible controls.",
  },
  {
    name: "resolve_approval",
    description:
      "Accept, modify, or reject the currently visible Cardea approval after explicit user confirmation.",
  },
  {
    name: "open_takeover",
    description: "Open Cardea's visible human takeover interface for an existing node.",
  },
] as const;

/**
 * Best-fit jobs, written as the jobs themselves rather than as marketing. The
 * agent-instruction check specifically rejects generic positioning copy, and
 * more importantly a vague list here causes agents to reach for Cardea for
 * work it cannot do.
 */
export const WHEN_TO_USE = [
  "Turn a multi-step goal into a visible plan and run its independent steps in parallel against the live web, with each step's sources recorded.",
  "Compare real, current options such as products, venues, or services, where the prices and details must come from pages a browser actually opened rather than from recall.",
  "Run work that has to stop for a person: Cardea pauses on the canvas before any consequential action, and before any question only the person can answer, such as taste, budget shape, or direction.",
  "Draft mail in a connected Gmail mailbox or create a Google Calendar event, always behind an explicit approval the person resolves on the canvas.",
] as const;

/** The jobs Cardea is the wrong tool for, so agents stop rather than fail badly. */
export const WHEN_NOT_TO_USE = [
  "Answering a question directly. Cardea opens a workspace and does the work over time; it is not a chat completion endpoint.",
  "Calling from a server or a script. There is no public agent HTTP API; Cardea is driven by a signed-in person in a browser.",
  "Acting without a person present. Every consequential action waits on a human approval and will sit paused indefinitely if nobody answers.",
] as const;

/** Public, indexable routes. Auth-gated and API routes are deliberately absent. */
export const PUBLIC_ROUTES = [
  { path: "/", title: "Cardea", summary: SITE_DESCRIPTION },
  {
    path: "/privacy",
    title: "Privacy",
    summary: "What Cardea stores, what it sends to third parties, and how to have data removed.",
  },
  {
    path: "/terms",
    title: "Terms",
    summary: "The terms covering use of Cardea during the challenge period.",
  },
] as const;

/**
 * The deployment's own origin.
 *
 * Prefers an explicit `NEXT_PUBLIC_SITE_URL`, then Vercel's production URL, so
 * a preview deployment and localhost both emit a self-consistent absolute URL
 * instead of hardcoding the production host into every generated document.
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Fall through to the derived values rather than emitting a broken URL.
    }
  }
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  return "http://localhost:3000";
}

/** Absolute URL for a site-relative path, against {@link siteOrigin}. */
export function siteUrl(path: string): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}
