/**
 * The geometry of the approval card that mounts beside a mission node.
 *
 * The card is the most important human moment on the board — it is where
 * Cardea stops and asks. So the board has to treat it as real furniture:
 * anything Cardea opens on its own must route around it, and the camera has
 * to be able to frame the node together with its card. Neither is possible
 * unless the card's world rectangle can be computed outside React, which is
 * what this module is for.
 */

import type { WorldRect } from "./place-free";

/** Anything that reads like a pending approval; mirrors `MissionApproval`. */
export type ApprovalLike = { id: string; nodeId: string | null };

/** Anything that reads like a laid-out mission node. */
export type NodeBox = { id: string; x: number; y: number; width: number; height: number };

/** A node's session-only drag offset, if the person moved it. */
export type DragOffset = { dx: number; dy: number };

/**
 * Mirrors `.approvalSlot { left: calc(100% + 26px) }` in
 * mission-layer.module.css. Changing the CSS means changing this.
 */
export const APPROVAL_SLOT_GAP = 26;

/**
 * Mirrors `.approvalSlot { width: 300px }` in mission-layer.module.css.
 * Changing the CSS means changing this.
 */
export const APPROVAL_SLOT_WIDTH = 300;

/**
 * The card's height is content-driven (an ask_user question with several
 * options is the tallest case), so there is no CSS value to mirror. This is
 * a measured upper bound: reserving slightly too much space only pushes an
 * auto-opened tab a little further away, while reserving too little would
 * let a tab land on the card.
 */
export const APPROVAL_RECT_HEIGHT = 460;

/** The node ids that currently have a pending approval attached. */
export function nodeIdsAwaitingApproval(approvals: readonly ApprovalLike[]): Set<string> {
  const ids = new Set<string>();
  for (const approval of approvals) {
    if (approval.nodeId) ids.add(approval.nodeId);
  }
  return ids;
}

/** A node's position with its session drag offset applied. */
function positionOf(node: NodeBox, offset: DragOffset | undefined): { x: number; y: number } {
  return { x: node.x + (offset?.dx ?? 0), y: node.y + (offset?.dy ?? 0) };
}

/**
 * The world rectangle each pending approval card occupies, one per node that
 * has an approval. Nodes without an approval contribute nothing, and an
 * approval whose node is not on the board is ignored rather than guessed at.
 */
export function approvalWorldRects(
  nodes: readonly NodeBox[],
  approvals: readonly ApprovalLike[],
  offsets: Readonly<Record<string, DragOffset>> = {},
): WorldRect[] {
  const awaiting = nodeIdsAwaitingApproval(approvals);
  if (awaiting.size === 0) return [];
  const rects: WorldRect[] = [];
  for (const node of nodes) {
    if (!awaiting.has(node.id)) continue;
    const { x, y } = positionOf(node, offsets[node.id]);
    rects.push({
      x: x + node.width + APPROVAL_SLOT_GAP,
      y,
      width: APPROVAL_SLOT_WIDTH,
      height: APPROVAL_RECT_HEIGHT,
    });
  }
  return rects;
}

/**
 * The box the camera should frame when an approval arrives: the node and its
 * card together, so the question and the work it belongs to are read as one
 * thing rather than the card being cropped off the side.
 */
export function approvalFrameBox(node: NodeBox, offset?: DragOffset): WorldRect {
  const { x, y } = positionOf(node, offset);
  return {
    x,
    y,
    width: node.width + APPROVAL_SLOT_GAP + APPROVAL_SLOT_WIDTH,
    height: Math.max(node.height, APPROVAL_RECT_HEIGHT),
  };
}
