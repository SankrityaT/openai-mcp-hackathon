/**
 * Pure mapping helpers behind Cardea's inbound WebMCP tool surface.
 *
 * The board's live mission handle speaks the mission-data-source vocabulary
 * (`MissionSpineNode`, `LiveMissionDataMode`); `useCardeaWebMCP` speaks the
 * bounded tool vocabulary (`NodeSummary`, `CardeaDataMode`). Everything that
 * translates between the two lives here, structurally typed and free of React
 * and of `@/core` imports, so it compiles and runs unchanged under the
 * self-contained `pnpm test:webmcp` suite.
 *
 * These helpers only rename and narrow. They never invent a node, a codename,
 * or a persistence claim that the handle did not already report.
 */

/** Structural mirror of `MissionSpineNode` from `@/core/contracts/mission-data-source`. */
export type BoardSpineNode = {
  id: string;
  codename: string;
  roleLabel: string;
  status: string;
};

/** Structural mirror of the `NodeSummary` accepted by `useCardeaWebMCP`. */
export type BoardNodeSummary = {
  id: string;
  codename: string;
  role: string;
  status: string;
};

/** Structural mirror of `LiveMissionDataMode`'s honesty flag. */
export type BoardPersistenceProbe = { persistenceAvailable: boolean };

/**
 * Truthful tool-facing mode. A board that is pending or unavailable has no
 * persistence, so it is reported as `fixture` rather than as a live surface
 * whose writes would be silently dropped.
 */
export function toCardeaDataMode(probe: BoardPersistenceProbe): "fixture" | "live" {
  return probe.persistenceAvailable ? "live" : "fixture";
}

/** Renames `roleLabel` to the tool surface's `role`. Order and count are preserved. */
export function toNodeSummaries(nodes: readonly BoardSpineNode[]): BoardNodeSummary[] {
  return nodes.map((node) => ({
    id: node.id,
    codename: node.codename,
    role: node.roleLabel,
    status: node.status,
  }));
}

/** Structural mirror of the `MissionApproval` fields the tool surface reports. */
export type BoardApproval = {
  id: string;
  nodeId: string | null;
  category: string;
  recommendation: string;
  alternatives: unknown[];
  consequence: string;
  status: string;
};

/** Bounded, tool-facing view of one pending approval. */
export type ApprovalSummary = {
  id: string;
  nodeId: string | null;
  category: string;
  /** The approval's recommendation. On an ask_user card this IS the question. */
  question: string;
  options: string[];
  consequence: string;
  status: string;
};

/** Matches the visible approval card's bound, so the tool reads what the person reads. */
const MAX_FIELD_CHARS = 300;
/** Matches the visible approval card's `boundedJson` bound for an opaque entry. */
const MAX_JSON_CHARS = 160;
/** The visible card lists every alternative; the tool surface stays bounded. */
const MAX_OPTIONS = 8;

function bound(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function boundedJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return bound(text, MAX_JSON_CHARS);
}

/**
 * Reduces one alternative to display text the same way the visible approval
 * card does: a string passes through, an object's non-empty `summary` wins,
 * and anything else falls back to bounded JSON. Reimplemented structurally
 * rather than imported, because this module stays free of React and `@/core`.
 */
function describeAlternative(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const summary = (item as Record<string, unknown>).summary;
    if (typeof summary === "string" && summary.trim()) return summary;
  }
  return boundedJson(item);
}

/**
 * Bounded approval content for the agent to relay to the person. It only
 * renames and truncates what the mission already reported; it never invents an
 * option, a consequence, or a decision.
 */
export function toApprovalSummaries(
  approvals: readonly BoardApproval[],
): ApprovalSummary[] {
  return approvals.map((approval) => ({
    id: approval.id,
    nodeId: approval.nodeId,
    category: approval.category,
    question: bound(approval.recommendation, MAX_FIELD_CHARS),
    options: approval.alternatives
      .slice(0, MAX_OPTIONS)
      .map((item) => bound(describeAlternative(item), MAX_FIELD_CHARS)),
    consequence: bound(approval.consequence, MAX_FIELD_CHARS),
    status: approval.status,
  }));
}

/**
 * The `open_mission` tool result.
 *
 * Switching a workspace moves the visible interface and nothing else, so the
 * success envelope claims one visible effect and names the mission it applies
 * to. A refusal names no mission: the strip has already said it does not know
 * that id, and echoing it back would read as though something was attempted.
 */
export function workspaceSwitchResult(missionId: string, switched: boolean): string {
  return switched
    ? JSON.stringify({ ok: true, visibleEffect: "workspace_switched", missionId })
    : JSON.stringify({ ok: false, failure: "unknown_mission" });
}

/** Opening a page spends a metered live-browser session, so a call is bounded. */
export const MAX_OPEN_PAGES = 3;

/** Bounds a URL to something a tab strip and a session log can carry. */
const MAX_PAGE_URL_CHARS = 2_000;

/**
 * The URLs `open_pages` will actually open: https only, deduplicated, bounded
 * in length and count. Anything else is dropped rather than repaired, because
 * repairing an agent-supplied URL would mean opening a page nobody named.
 */
export function sanitizePageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const url = entry.trim();
    if (url.length === 0 || url.length > MAX_PAGE_URL_CHARS) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(key);
    if (accepted.length === MAX_OPEN_PAGES) break;
  }
  return accepted;
}

/**
 * The `open_pages` tool result. Success names exactly the pages that opened
 * as canvas tiles; a refusal explains itself without echoing rejected input
 * back as though it had been attempted.
 */
export function openPagesResult(accepted: readonly string[]): string {
  return accepted.length > 0
    ? JSON.stringify({
        ok: true,
        visibleEffect: "pages_opened",
        opened: accepted.length,
        urls: accepted,
      })
    : JSON.stringify({ ok: false, failure: "no_valid_urls" });
}

/** The codename the composer should be scoped to, or null when the node is unknown. */
export function codenameForNode(
  nodes: readonly BoardSpineNode[],
  nodeId: string,
): string | null {
  return nodes.find((node) => node.id === nodeId)?.codename ?? null;
}
