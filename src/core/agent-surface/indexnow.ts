/**
 * IndexNow (https://www.indexnow.org): push a URL list to participating search
 * engines instead of waiting to be crawled. Bing and Yandex participate;
 * Google does not, so this complements Search Console rather than replacing it.
 *
 * Bing is the reason this is worth having here: it is the index behind
 * ChatGPT's and Copilot's web results, which is exactly the audience Cardea's
 * agent-facing surfaces are written for.
 *
 * Pure and dependency-free. The route handlers in `src/app` own the network
 * call and the environment; everything that can be decided without I/O is
 * decided here so it can be tested directly.
 */

/**
 * Where the key file is served. IndexNow's default is `/<key>.txt`, but the
 * protocol also accepts a `keyLocation` anywhere at or above the submitted
 * URLs. A fixed path is used so the key can live in one place (an environment
 * variable, read by both routes) instead of being duplicated into a committed
 * filename that could silently drift from it.
 */
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

/**
 * The shared endpoint. Submitting here fans out to every participating engine,
 * so there is no need to POST Bing and Yandex separately.
 */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The payload shape IndexNow expects. */
export type IndexNowSubmission = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

/**
 * Key rules, from the IndexNow spec: 8 to 128 characters, and only a-z, A-Z,
 * 0-9, and dashes. Validated before use so a misconfigured key fails here,
 * with a clear reason, rather than as an opaque 403 from the API.
 */
export function isValidIndexNowKey(key: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/.test(key);
}

/**
 * Builds a submission for the given origin.
 *
 * Throws on an invalid key or a path that would escape the host: IndexNow
 * answers 422 for a URL outside the submitted host, and catching that here
 * turns a remote rejection into a local, explicable failure.
 */
export function buildIndexNowSubmission(
  origin: string,
  key: string,
  paths: readonly string[],
): IndexNowSubmission {
  if (!isValidIndexNowKey(key)) {
    throw new Error("IndexNow key must be 8 to 128 characters of A-Z, a-z, 0-9, or dashes");
  }
  const base = new URL(origin);
  const urlList = paths.map((path) => {
    const url = new URL(path, base);
    if (url.host !== base.host) {
      throw new Error(`Refusing to submit ${url.href}: not on ${base.host}`);
    }
    return url.href;
  });

  return {
    host: base.host,
    key,
    keyLocation: new URL(INDEXNOW_KEY_PATH, base).href,
    urlList,
  };
}

/**
 * What a response status from IndexNow actually means, per the protocol's
 * published table. Mapped explicitly so a caller reports the real outcome
 * rather than collapsing everything into "ok" or "failed" — a 202, in
 * particular, is a success whose key check is still pending, and a 403 means
 * the key file is unreachable, which is a configuration bug worth surfacing.
 */
export function describeIndexNowStatus(status: number): { ok: boolean; meaning: string } {
  switch (status) {
    case 200:
      return { ok: true, meaning: "Submitted. URLs accepted for crawling." };
    case 202:
      return { ok: true, meaning: "Accepted. Key validation still pending." };
    case 400:
      return { ok: false, meaning: "Bad request: the submission format was rejected." };
    case 403:
      return {
        ok: false,
        meaning: `Forbidden: the key file at ${INDEXNOW_KEY_PATH} could not be read or did not match.`,
      };
    case 422:
      return {
        ok: false,
        meaning: "Unprocessable: a submitted URL does not belong to the declared host.",
      };
    case 429:
      return { ok: false, meaning: "Rate limited: too many submissions for this host." };
    default:
      return { ok: false, meaning: `Unexpected status ${status} from IndexNow.` };
  }
}
