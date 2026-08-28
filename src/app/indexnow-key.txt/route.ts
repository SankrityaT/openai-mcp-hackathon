import { isValidIndexNowKey } from "@/core/agent-surface/indexnow";

/**
 * The IndexNow key file. Search engines fetch this to confirm that whoever
 * submitted a URL list actually controls this host.
 *
 * The key is public by design — proving host control is its only job, and
 * anyone can read it here — so it lives in `INDEXNOW_KEY` purely to keep one
 * source of truth shared with the submission route, not as a secret.
 *
 * With no key configured this 404s rather than serving an empty file: an empty
 * or malformed key file makes IndexNow answer 403 on every submission, and a
 * missing file is the honest description of "IndexNow is not set up here".
 */
export function GET() {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !isValidIndexNowKey(key)) {
    return new Response("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
