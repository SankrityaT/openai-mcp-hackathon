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

/** The codename the composer should be scoped to, or null when the node is unknown. */
export function codenameForNode(
  nodes: readonly BoardSpineNode[],
  nodeId: string,
): string | null {
  return nodes.find((node) => node.id === nodeId)?.codename ?? null;
}
