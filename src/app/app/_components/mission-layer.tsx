"use client";

import type { BoardLayout } from "@/core/board/plan-layout";
import styles from "./mission-layer.module.css";

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

export function MissionLayer({ layout }: { layout: BoardLayout }) {
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>([
    [layout.root.id, layout.root],
    ...layout.nodes.map(
      (node) =>
        [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }] as const,
    ),
  ]);

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
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              className={styles.connector}
              d={connectorPath(from, to)}
              // Normalises every curve to length 1 so the dash animation runs at
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
        <span className={styles.rootLabel}>Mission</span>
        <h2>{layout.title}</h2>
        <p>{layout.summary}</p>
      </article>

      {layout.nodes.map((node, index) => (
        <article
          key={node.id}
          className={styles.node}
          style={{
            transform: `translate(${node.x}px, ${node.y}px)`,
            width: node.width,
            height: node.height,
            animationDelay: `${300 + index * 70}ms`,
          }}
          tabIndex={0}
          aria-label={`${node.codename}, ${node.roleLabel}. Planned. ${node.objective}`}
        >
          <header>
            <span className={styles.codename}>
              {node.codename} <i aria-hidden="true">·</i> {node.roleLabel}
            </span>
            <span className={styles.state}>
              <i className={styles.stateDot} aria-hidden="true" />
              Planned
            </span>
          </header>
          <p className={styles.objective}>{node.objective}</p>
          {node.capabilityNames.length > 0 && (
            <ul className={styles.capabilities}>
              {node.capabilityNames.slice(0, 3).map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
