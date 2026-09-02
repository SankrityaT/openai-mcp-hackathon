"use client";

import type { BoardLayout } from "@/core/board/plan-layout";
import type { MissionApproval } from "@/core/contracts/types";
import { type WorkSurface } from "@/core/contracts/work-surface";
import { ApprovalCard } from "./approval-card";
import { NodeCard, type NodeCardStatus } from "./node-card";
import styles from "./mission-layer.module.css";

export type MissionNodeView = {
  status: NodeCardStatus;
  surface: WorkSurface;
  lastEventAt: string | null;
  /** The newest recorded tool or evidence summary, so the card shows work. */
  latestSummary?: string | null;
  /** Why a paused node is paused, stated in place. */
  pausedNote?: string | null;
  /** What a running node is inside right now, from its own tool.started. */
  activityNote?: string | null;
};

/**
 * A calm curved path from one node's right edge to the next node's left edge.
 * Horizontal control points keep the curve leaving and entering flat, which
 * reads as a routed line rather than a diagonal drawn between two dots.
 */
function connectorPath(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const reach = Math.max(46, Math.abs(x2 - x1) * 0.5);
  return `M${x1} ${y1} C${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
}

export function MissionLayer({
  layout,
  views,
  approvals,
  resolvingApprovalId,
  selectedNodeId,
  preview,
  offsets,
  zOrder,
  onSelectNode,
  onOpenTakeover,
  onResolveApproval,
  onRememberApproval,
  onNodePointerDown,
}: {
  layout: BoardLayout;
  /** Per-node live view state keyed by node id; absent nodes render as planned captures. */
  views: ReadonlyMap<string, MissionNodeView>;
  approvals: readonly MissionApproval[];
  resolvingApprovalId: string | null;
  selectedNodeId: string | null;
  /** True when the layout is an unpersisted planner preview, not a live mission. */
  preview: boolean;
  /** Session-only drag offsets per node id, in world units. */
  offsets?: Record<string, { dx: number; dy: number }>;
  /** "Last touched wins" z-order per node id. */
  zOrder?: Record<string, number>;
  onSelectNode?: (id: string) => void;
  onOpenTakeover?: (id: string) => void;
  onResolveApproval?: (
    approvalId: string,
    decision: "accept" | "modify" | "reject",
    note?: string,
  ) => void;
  /** Saves a stated preference into memory; absent for guest sessions. */
  onRememberApproval?: (text: string) => Promise<void>;
  /** Fired on any pointer press in a node slot; drag starts from its handle. */
  onNodePointerDown?: (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>([
    [layout.root.id, layout.root],
    ...layout.nodes.map(
      (node) =>
        [
          node.id,
          {
            x: node.x + (offsets?.[node.id]?.dx ?? 0),
            y: node.y + (offsets?.[node.id]?.dy ?? 0),
            width: node.width,
            height: node.height,
          },
        ] as const,
    ),
  ]);

  const approvalsByNode = new Map<string, MissionApproval>();
  for (const approval of approvals) {
    if (approval.nodeId && !approvalsByNode.has(approval.nodeId)) {
      approvalsByNode.set(approval.nodeId, approval);
    }
  }

  // The SVG spans the plan's bounds in world units, padded so a curve that
  // bows outside the node boxes is not clipped.
  const pad = 80;
  const frame = {
    x: layout.bounds.x - pad,
    y: layout.bounds.y - pad,
    width: layout.bounds.width + pad * 2,
    height: layout.bounds.height + pad * 2,
  };

  return (
    <div className={styles.layer}>
      <svg
        className={styles.connectors}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        aria-hidden="true"
      >
        {layout.edges.map((edge, index) => {
          const from = boxes.get(edge.from);
          const to = boxes.get(edge.to);
          if (!from || !to) return null;
          // Traveling energy only while the downstream node is running; the
          // path itself stays calm otherwise. Motion carries state.
          const active = views.get(edge.to)?.status === "running";
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              className={styles.connector}
              data-active={active || undefined}
              d={connectorPath(from, to)}
              // Normalises every curve to length 1 so dash animation runs at
              // one rate regardless of how far the dependency reaches.
              pathLength={1}
              style={{ animationDelay: `${240 + index * 55}ms` }}
            />
          );
        })}
      </svg>

      <article
        className={styles.root}
        style={{
          transform: `translate(${layout.root.x}px, ${layout.root.y}px)`,
          width: layout.root.width,
          height: layout.root.height,
        }}
      >
        <span className={styles.rootLabel}>{preview ? "Plan preview" : "Mission"}</span>
        <h2>{layout.title}</h2>
        <p>{layout.summary}</p>
        {preview && <span className={styles.previewNote}>Not persisted. Sign in or retry to run it.</span>}
      </article>

      {layout.nodes.map((node, index) => {
        const view = views.get(node.id);
        const approval = approvalsByNode.get(node.id);
        return (
          <div
            key={node.id}
            className={styles.nodeSlot}
            style={{
              transform: `translate(${node.x + (offsets?.[node.id]?.dx ?? 0)}px, ${node.y + (offsets?.[node.id]?.dy ?? 0)}px)`,
              width: node.width,
              height: node.height,
              animationDelay: `${300 + index * 70}ms`,
              zIndex: zOrder?.[node.id],
            }}
            onPointerDown={(event) => onNodePointerDown?.(node.id, event)}
          >
            <NodeCard
              node={{
                id: node.id,
                codename: node.codename,
                roleLabel: node.roleLabel,
                objective: node.objective,
                capabilityNames: node.capabilityNames,
              }}
              status={view?.status ?? "planned"}
              surface={view?.surface ?? { kind: "capture", domain: null }}
              lastEventAt={view?.lastEventAt ?? null}
              latestWork={view?.latestSummary ?? null}
              activity={view?.activityNote ?? null}
              commentary={view?.pausedNote ?? null}
              selected={node.id === selectedNodeId}
              onSelect={onSelectNode}
              onOpenTakeover={onOpenTakeover}
            />
            {approval && onResolveApproval && (
              <div className={styles.approvalSlot}>
                <ApprovalCard
                  approval={approval}
                  resolving={resolvingApprovalId === approval.id}
                  onResolve={(decision, note) => onResolveApproval(approval.id, decision, note)}
                  onRemember={onRememberApproval}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
