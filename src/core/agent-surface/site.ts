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
  "Every mark above is a live wire in the deployed product, from the browser sessions to the storefront carts.";

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
    name: "Cloudflare",
    slug: "cloudflare",
    role: "Live browser",
    href: "https://developers.cloudflare.com/browser-rendering/",
  },
  {
    name: "Shopify",
    slug: "shopify",
    role: "Agentic commerce",
    href: "https://shopify.dev/",
  },
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
      "Read a bounded summary of the visible Cardea mission, nodes, states, and pending decisions. Each pending approval comes back with its question, its options, and its consequence, which you should relay to the person in their own words so they can choose.",
  },
  {
    name: "update_mandate",
    description: "Propose a bounded change to the visible Cardea mandate for the user to review.",
  },
  {
    name: "approve_mandate",
    description:
      "Approve the visible Cardea mandate so planning can begin, after the person gives their explicit yes. It does not grant spending, sending, or account changes, which each still stop at their own approval.",
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
      "Accept, modify, or reject a visible Cardea approval after explicit user confirmation. When several approvals are pending, pass the approvalId from inspect_canvas. For a question card, pass the person's chosen option as the note with decision modify, after they explicitly chose it.",
  },
  {
    name: "open_takeover",
    description: "Open Cardea's visible human takeover interface for an existing node.",
  },
  {
    name: "open_pages",
    description:
      "Open up to 3 public https pages as live browser tiles on the visible Cardea canvas, placed beside the mission so the person can watch them. Each page spends one of the person's metered live-browser sessions, so open only pages they asked to see or that the mission's evidence names.",
  },
  {
    name: "list_missions",
    description:
      "List this person's recent Cardea missions as workspaces, newest first, so one can be opened with open_mission.",
  },
  {
    name: "open_mission",
    description:
      "Switch the visible Cardea workspace to one of the person's existing missions by id from list_missions. Interface only: it changes what is on screen and never changes mission state.",
  },
] as const;

/**
 * The landing page's narrative sections, single-sourced so the HTML a person
 * reads and the markdown an agent scrapes are the same story by construction.
 * page.tsx renders these; documents.ts folds them into the markdown
 * representation served by content negotiation.
 */
export const LANDING_NARRATIVE = [
  {
    eyebrow: "How it works",
    title: "Watch the work, not a spinner.",
    body:
      "Cardea does not answer from recall. Give it a goal with real moving parts and it opens real pages in its own browser, runs the independent branches in parallel, and stops at the threshold whenever the next move is yours.",
    items: [
      {
        lead: "Live browsing.",
        text: "Every branch opens real pages in Cardea's Cloudflare-run browser, and you can watch, open, scroll, and take over.",
      },
      {
        lead: "Parallel branches.",
        text: "Independent work runs at once, and each step hands its evidence to the ones that depend on it.",
      },
      {
        lead: "The hinge.",
        text: "When only you can answer, the mission stops and asks, and your answer steers everything downstream.",
      },
    ],
  },
  {
    eyebrow: "Memory",
    title: "Memory you approve.",
    body:
      "Cardea notices what your missions reveal, your taste, your budget shape, the way you decide, and asks before keeping any of it. Promoted memory sharpens the next plan. Everything is visible, editable, and yours to forget.",
    items: [],
  },
  {
    eyebrow: "Authority",
    title: "Nothing commits without you.",
    body:
      "Every mission starts from a mandate you approve, spends only what you loaded, and stops at a visible approval before anything consequential leaves Cardea.",
    items: [
      {
        lead: "The mandate.",
        text: "Goal, constraints, and every capability the mission may reach, reviewed before planning begins.",
      },
      {
        lead: "Context wallet.",
        text: "Collectible passes carry the context and spending limits a mission is allowed to use.",
      },
      {
        lead: "Hard stops.",
        text: "Research runs freely. Carts, drafts, and events wait for you. Sending and spending never happen on their own.",
      },
      {
        lead: "Connected apps.",
        text: "OpenAI plans, Chrome carries WebMCP, Cloudflare runs the live browser, Composio reaches Gmail and Calendar through official OAuth, Supermemory keeps what you told it to, and Shopify prepares the cart.",
      },
    ],
  },
  {
    eyebrow: "The finish",
    title: "It ends with the thing done.",
    body:
      "A mission does not end in a report. Cardea comes back, says the pick in one line, opens the order page on your canvas, and waits at the last click, the one that spends, for you. Your answer is remembered only if you say so.",
    items: [],
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
