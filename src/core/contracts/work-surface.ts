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

export type WorkSurface =
  | { kind: "webmcp"; origin: string; label: string }
  | { kind: "capture"; domain: string | null };

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
