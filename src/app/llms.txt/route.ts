import { llmsTxt } from "@/core/agent-surface/documents";
import { siteOrigin } from "@/core/agent-surface/site";

/**
 * `/llms.txt`, per llmstxt.org: the agent-facing index of what Cardea is, the
 * jobs it is the right tool for, the jobs it is the wrong tool for, and how an
 * agent actually calls it.
 *
 * Served as `text/plain` because that is the media type llmstxt.org specifies
 * for the file (its *content* is markdown), and it is what makes the file
 * readable in a browser rather than triggering a download.
 */
export function GET() {
  return new Response(llmsTxt(siteOrigin()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
