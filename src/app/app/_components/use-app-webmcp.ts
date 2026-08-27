"use client";

import type { LiveMissionHandle } from "../_data/use-live-mission";

/**
 * The controls the board hands to Cardea's inbound WebMCP tools: selection,
 * camera focus, and the takeover surface. Defined here rather than in
 * board.tsx so the T7 port fills this file without touching the board.
 */
export type BoardMissionControls = {
  selectedNodeId: string | null;
  /** Returns false for unknown node ids, per the tool contract. */
  focusNode: (nodeId: string) => boolean;
  /** Returns false for unknown node ids. */
  openTakeover: (nodeId: string) => boolean;
  /** Opens the composer scoped to a node codename. */
  openComposer: (codename: string | null) => void;
};

/**
 * Placeholder call site for the 8 inbound WebMCP tools on /app. The wave-3
 * port replaces this body with a real useCardeaWebMCP(actions) wiring; until
 * then the board mounts it so the seam already exists.
 */
export function useAppWebmcp(_input: {
  handle: LiveMissionHandle;
  controls: BoardMissionControls;
}) {
  void _input;
}
