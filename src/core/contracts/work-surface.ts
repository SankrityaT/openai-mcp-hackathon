/**
 * A mission node's honest "work surface": is Cardea actually operating a
 * WebMCP-controlled surface, or is this node only ever going to show a
 * truthful capture (a screenshot, a fetched page, a recorded result) with no
 * live control claim attached?
 *
 * The mapping below is deterministic and closed over the identifiers already
 * catalogued in `safe-capabilities.ts`. Nothing here trusts a model-produced
 * label, capability description, or free-text field: the badge shown to the
 * person is derived only from ids Cardea itself defined ahead of time. That
 * is what keeps the browser-tab chrome honest, since the product must never
 * claim live browser control it does not have.
 */
import {
  COMPOSIO_APPROVAL_GATED_CAPABILITIES,
  COMPOSIO_PROVIDER_ORIGIN,
  COMPOSIO_SAFE_READ_CAPABILITIES,
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  WEB_LOOKUP_CAPABILITY_ID,
} from "./safe-capabilities";

/**
 * Both catalogued spellings of every Composio capability: the id form the
 * contract uses ("composio.gmail_fetch_emails") and the advertised tool name
 * ("GMAIL_FETCH_EMAILS"). Planner output may carry either; both are closed,
 * reviewed identifiers, so recognizing them stays deterministic.
 */
const COMPOSIO_KNOWN_NAMES = new Set<string>(
  [...COMPOSIO_SAFE_READ_CAPABILITIES, ...COMPOSIO_APPROVAL_GATED_CAPABILITIES].flatMap(
    (capability) => [capability.id, capability.tool],
  ),
);

/**
 * `live` marks a capture taken by Cardea's own remote browser, which really
 * did open a page. It is NOT a webmcp surface: WebMCP means a site handed
 * Cardea structured tools, and the web lookup has no such thing. It reads a
 * page the way a person would and brings back text, so the honest badge stays
 * a capture, and `live` only adds that a real browser took it.
 */
export type WorkSurface =
  | { kind: "webmcp"; origin: string; label: string }
  | { kind: "capture"; domain: string | null; live?: boolean };

const COMPOSIO_CAPABILITY_PREFIX = "composio.";
const COMPANION_CAPABILITY_MARKER = "companion.";

/**
 * Origin host without protocol, for example `https://composio.dev` ->
 * `composio.dev`. Returns null for a malformed origin rather than throwing,
 * so a bad origin degrades to an honest capture instead of crashing render.
 */
function hostLabel(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Derives the honest work surface for a node from its required capability
 * names. Recognition order follows the capability list: the first name that
 * matches a known pattern decides the result, even if that result is a
 * fallback to capture (for example, a companion capability with no supplied
 * origin). Unknown or empty capability lists always resolve to an unlabelled
 * capture, never a guessed webmcp origin.
 */
export function deriveWorkSurface(
  capabilityNames: string[],
  companionOrigin?: string | null,
): WorkSurface {
  for (const name of capabilityNames) {
    if (name === WEB_LOOKUP_CAPABILITY_ID) {
      // The browsed domain is only known once the node has actually run, and
      // this derivation sees capability names alone. So the domain stays null
      // here and the badge says "live browser" rather than naming a host the
      // node has not visited yet.
      return { kind: "capture", domain: null, live: true };
    }

    if (name === INTERNAL_FIXTURE_CAPABILITY_ID) {
      const label = hostLabel(INTERNAL_FIXTURE_ORIGIN);
      if (label) return { kind: "webmcp", origin: INTERNAL_FIXTURE_ORIGIN, label };
      return { kind: "capture", domain: null };
    }

    if (name.startsWith(COMPOSIO_CAPABILITY_PREFIX) || COMPOSIO_KNOWN_NAMES.has(name)) {
      const label = hostLabel(COMPOSIO_PROVIDER_ORIGIN);
      if (label) return { kind: "webmcp", origin: COMPOSIO_PROVIDER_ORIGIN, label };
      return { kind: "capture", domain: null };
    }

    if (name.includes(COMPANION_CAPABILITY_MARKER)) {
      const label = companionOrigin ? hostLabel(companionOrigin) : null;
      if (label && companionOrigin) {
        return { kind: "webmcp", origin: companionOrigin, label };
      }
      return { kind: "capture", domain: null };
    }
  }

  return { kind: "capture", domain: null };
}
