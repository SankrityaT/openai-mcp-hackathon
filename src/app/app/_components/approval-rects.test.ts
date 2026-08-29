import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_RECT_HEIGHT,
  APPROVAL_SLOT_GAP,
  APPROVAL_SLOT_WIDTH,
  approvalFrameBox,
  approvalWorldRects,
  nodeIdsAwaitingApproval,
  type NodeBox,
} from "./approval-rects";
import { placeRow, type WorldRect } from "./place-free";

const NODES: NodeBox[] = [
  { id: "a", x: 0, y: 0, width: 268, height: 236 },
  { id: "b", x: 376, y: -300, width: 268, height: 236 },
];

function overlaps(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("only nodes with a pending approval are counted", () => {
  const ids = nodeIdsAwaitingApproval([
    { id: "ap1", nodeId: "a" },
    { id: "ap2", nodeId: null },
    { id: "ap3", nodeId: "a" },
  ]);
  assert.deepEqual([...ids], ["a"]);
  assert.deepEqual([...nodeIdsAwaitingApproval([])], []);
});

test("an approval rect sits beside its node at the CSS gap and width", () => {
  const rects = approvalWorldRects(NODES, [{ id: "ap1", nodeId: "b" }]);
  assert.deepEqual(rects, [
    {
      x: 376 + 268 + APPROVAL_SLOT_GAP,
      y: -300,
      width: APPROVAL_SLOT_WIDTH,
      height: APPROVAL_RECT_HEIGHT,
    },
  ]);
});

test("a dragged node carries its approval rect with it", () => {
  const rects = approvalWorldRects(NODES, [{ id: "ap1", nodeId: "a" }], { a: { dx: 40, dy: -25 } });
  assert.deepEqual(rects, [
    { x: 40 + 268 + APPROVAL_SLOT_GAP, y: -25, width: APPROVAL_SLOT_WIDTH, height: APPROVAL_RECT_HEIGHT },
  ]);
});

test("approvals with no node, and nodes off the board, reserve nothing", () => {
  assert.deepEqual(approvalWorldRects(NODES, [{ id: "ap1", nodeId: null }]), []);
  assert.deepEqual(approvalWorldRects(NODES, [{ id: "ap1", nodeId: "ghost" }]), []);
  assert.deepEqual(approvalWorldRects([], [{ id: "ap1", nodeId: "a" }]), []);
});

test("a placed tab row clears the reserved approval rect", () => {
  const nodes = [NODES[0]];
  const approvals = [{ id: "ap1", nodeId: "a" }];
  const nodeRects: WorldRect[] = nodes.map((node) => ({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }));
  const cards = approvalWorldRects(nodes, approvals);
  const anchor = { centerX: 400, minY: 300 };
  const tile = { width: 580, height: 420 };

  // Without the reservation the row lands clear of the node and straight
  // across the card, which is the bug this rect exists to prevent.
  const naive = placeRow(nodeRects, 3, tile, anchor);
  assert.equal(
    naive.some((placed) => cards.some((card) => overlaps(placed, card))),
    true,
  );

  const row = placeRow([...nodeRects, ...cards], 3, tile, anchor);
  for (const placed of row) {
    for (const reserved of [...nodeRects, ...cards]) {
      assert.equal(overlaps(placed, reserved), false);
    }
  }
});

test("the frame box spans the node and its card", () => {
  assert.deepEqual(approvalFrameBox(NODES[0]), {
    x: 0,
    y: 0,
    width: 268 + APPROVAL_SLOT_GAP + APPROVAL_SLOT_WIDTH,
    height: APPROVAL_RECT_HEIGHT,
  });
  assert.deepEqual(approvalFrameBox({ id: "tall", x: 10, y: 20, width: 268, height: 900 }), {
    x: 10,
    y: 20,
    width: 268 + APPROVAL_SLOT_GAP + APPROVAL_SLOT_WIDTH,
    height: 900,
  });
  assert.equal(approvalFrameBox(NODES[0], { dx: -5, dy: 7 }).x, -5);
  assert.equal(approvalFrameBox(NODES[0], { dx: -5, dy: 7 }).y, 7);
});
