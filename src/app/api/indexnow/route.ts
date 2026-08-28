import {
  INDEXNOW_ENDPOINT,
  buildIndexNowSubmission,
  describeIndexNowStatus,
} from "@/core/agent-surface/indexnow";
import { PUBLIC_ROUTES, siteOrigin } from "@/core/agent-surface/site";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";

/**
 * Pushes Cardea's public URLs to IndexNow, so Bing and Yandex crawl the new
 * deployment instead of waiting to rediscover it.
 *
 * Takes no input. The URL list is `PUBLIC_ROUTES` — the same list behind
 * `/sitemap.xml` — so there is nothing for a caller to influence: the worst a
 * stranger can do by calling this is ask search engines to re-crawl pages that
 * are already public. That is why it needs no secret, and why the rate limit
 * exists to cap our own outbound volume rather than to authorize anyone.
 *
 * Every outcome is reported as what actually happened, including the upstream
 * status and its documented meaning. A 202 is reported as accepted-but-pending
 * rather than as confirmed success.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit("indexnow", readIpSignalHash(request));
  if (limited) return limited;

  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    // Not an error in the request: the deployment simply has no key. Said
    // plainly rather than reported as a failed submission.
    return Response.json(
      { submitted: false, reason: "INDEXNOW_KEY is not configured for this deployment." },
      { status: 503 },
    );
  }

  const origin = siteOrigin();
  let submission;
  try {
    submission = buildIndexNowSubmission(
      origin,
      key,
      PUBLIC_ROUTES.map((route) => route.path),
    );
  } catch (error) {
    return Response.json(
      { submitted: false, reason: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  let response: Response;
  try {
    response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(submission),
      // IndexNow is a fire-and-forget notification. Waiting on it longer than
      // this would hold a function open for a service whose answer changes
      // nothing we do next.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return Response.json(
      {
        submitted: false,
        reason: `Could not reach IndexNow: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }

  const described = describeIndexNowStatus(response.status);
  return Response.json(
    {
      submitted: described.ok,
      status: response.status,
      meaning: described.meaning,
      host: submission.host,
      keyLocation: submission.keyLocation,
      urls: submission.urlList,
    },
    { status: described.ok ? 200 : 502 },
  );
}
