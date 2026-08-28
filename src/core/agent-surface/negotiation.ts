/**
 * HTTP `Accept` negotiation, per RFC 9110 §12.5.1 and the acceptmarkdown.com
 * convention (serve markdown for `Accept: text/markdown`, set `Vary: Accept`,
 * answer `406` for a request that accepts nothing we can produce, honor
 * q-values).
 *
 * Pure and dependency-free so it can be exhaustively tested away from the
 * request pipeline. `src/proxy.ts` is the only caller, and it runs on every
 * request to the site: a bug here is a site-wide outage, which is exactly why
 * the parsing lives in its own module with its own tests rather than inline in
 * the proxy.
 */

/** One parsed entry of an `Accept` header, e.g. `text/*;q=0.8`. */
export type MediaRange = {
  type: string;
  subtype: string;
  /** RFC 9110 weight in [0, 1]. Absent `q` means 1. `q=0` means "not acceptable". */
  quality: number;
};

/** Returned when the client accepts nothing the server can produce (→ 406). */
export const NOT_ACCEPTABLE = Symbol("not_acceptable");

/**
 * Parses `q` out of a parameter list. Anything unparseable falls back to 1,
 * matching RFC 9110's "a sender that does not include a weight means 1", and
 * refusing to let a malformed parameter silently downgrade a valid request.
 */
function parseQuality(parameters: string[]): number {
  for (const parameter of parameters) {
    const [rawName, rawValue] = parameter.split("=");
    if (rawName?.trim().toLowerCase() !== "q") continue;
    const value = Number.parseFloat(rawValue ?? "");
    if (!Number.isFinite(value)) return 1;
    // Clamp rather than reject: a weight outside the range is a malformed
    // sender, not a reason to make the whole header unusable.
    return Math.min(1, Math.max(0, value));
  }
  return 1;
}

/**
 * Parses an `Accept` header into media ranges. An entry that is not a
 * `type/subtype` shape is skipped rather than throwing: a hostile or broken
 * Accept header must never be able to crash the request pipeline.
 */
export function parseAcceptHeader(header: string | null | undefined): MediaRange[] {
  if (!header) return [];
  const ranges: MediaRange[] = [];
  for (const entry of header.split(",")) {
    const [rawRange, ...parameters] = entry.split(";");
    const range = rawRange?.trim().toLowerCase();
    if (!range) continue;
    const slash = range.indexOf("/");
    if (slash <= 0 || slash === range.length - 1) continue;
    const type = range.slice(0, slash);
    const subtype = range.slice(slash + 1);
    if (!type || !subtype) continue;
    ranges.push({ type, subtype, quality: parseQuality(parameters) });
  }
  return ranges;
}

/**
 * How specifically a range matches a concrete media type: 3 for an exact
 * `type/subtype`, 2 for `type/*`, 1 for `*​/*`, 0 for no match.
 *
 * RFC 9110 §12.5.1: "Media ranges can be overridden by more specific media
 * ranges", so the most specific matching range is the one whose weight counts,
 * which is what makes `Accept: *​/*;q=0.1, text/markdown` behave correctly.
 */
function specificity(range: MediaRange, type: string, subtype: string): number {
  if (range.type === type && range.subtype === subtype) return 3;
  if (range.type === type && range.subtype === "*") return 2;
  if (range.type === "*" && range.subtype === "*") return 1;
  return 0;
}

/** The weight the header assigns to one concrete media type, or null if unmatched. */
export function qualityFor(ranges: readonly MediaRange[], mediaType: string): number | null {
  const slash = mediaType.indexOf("/");
  const type = mediaType.slice(0, slash).toLowerCase();
  const subtype = mediaType.slice(slash + 1).toLowerCase();

  let best = 0;
  let bestQuality: number | null = null;
  for (const range of ranges) {
    const score = specificity(range, type, subtype);
    if (score === 0 || score < best) continue;
    best = score;
    bestQuality = range.quality;
  }
  return bestQuality;
}

/**
 * Picks the representation to serve.
 *
 * `available` is in server-preference order, which breaks ties: with
 * `Accept: text/html, text/markdown` (equal weights) an ordinary browser still
 * gets HTML, because HTML is listed first.
 *
 * Returns {@link NOT_ACCEPTABLE} only when the client sent an `Accept` header
 * that positively excludes everything on offer. A missing or empty header is
 * "no preference" and yields the server's first choice, never a 406.
 */
export function negotiateMediaType(
  header: string | null | undefined,
  available: readonly string[],
): string | typeof NOT_ACCEPTABLE {
  if (available.length === 0) return NOT_ACCEPTABLE;
  const ranges = parseAcceptHeader(header);
  // No header, or a header with nothing parseable in it, is no preference.
  if (ranges.length === 0) return available[0] as string;

  let chosen: string | null = null;
  let chosenQuality = 0;
  for (const candidate of available) {
    const quality = qualityFor(ranges, candidate);
    if (quality === null || quality <= 0) continue;
    if (quality > chosenQuality) {
      chosen = candidate;
      chosenQuality = quality;
    }
  }
  return chosen ?? NOT_ACCEPTABLE;
}
