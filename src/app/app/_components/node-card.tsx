"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { WorkSurface } from "@/core/contracts/work-surface";
import styles from "./node-card.module.css";

/**
 * The subset of NodeStatus a card ever renders. "cancelled" nodes are pruned
 * from the board before they reach this component.
 */
export type NodeCardStatus =
  | "planned"
  | "running"
  | "paused"
  | "needs_approval"
  | "waiting"
  | "completed"
  | "failed";

export type NodeCardProps = {
  node: {
    id: string;
    codename: string;
    roleLabel: string;
    objective: string;
    capabilityNames: string[];
  };
  status: NodeCardStatus;
  surface: WorkSurface;
  /** ISO time of the latest tool.completed or evidence.recorded event. */
  lastEventAt?: string | null;
  /** The newest recorded work summary; real evidence, never synthesized. */
  latestWork?: string | null;
  /** One sentence of Cardea commentary, shown beneath the node. */
  commentary?: string | null;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Renders an "Open" affordance only when provided. */
  onOpenTakeover?: (id: string) => void;
  /** Embedded surface content, such as a companion iframe or future stream. */
  children?: ReactNode;
};

const STATUS_LABEL: Record<NodeCardStatus, string> = {
  planned: "Planned",
  running: "Running",
  paused: "Paused",
  needs_approval: "Needs approval",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
};

/**
 * Sentence-case, tested rounding for the capture badge's freshness readout.
 * Deliberately coarse: this labels evidence recency, not a stopwatch.
 */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const diffMs = Math.max(0, now.getTime() - then);
  if (diffMs < 45_000) return "just now";

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * The badge string is the one honest claim this card makes about control.
 * `WebMCP` is only ever shown for a surface Cardea derived from a catalogued
 * capability id; every other node reads `Capture`, with a freshness label
 * once something has actually run, and `pending` before anything has.
 */
function surfaceBadge(surface: WorkSurface, lastEventAt?: string | null): string {
  if (surface.kind === "webmcp") {
    return `WebMCP · ${surface.label}`;
  }
  if (surface.domain && lastEventAt) {
    return `Capture · ${surface.domain} · ${relativeTimeLabel(lastEventAt)}`;
  }
  // A live capture is still a capture, not control. The only extra claim is
  // that Cardea's own remote browser is the thing taking it.
  if (surface.live) {
    return lastEventAt
      ? `Capture · live browser · ${relativeTimeLabel(lastEventAt)}`
      : "Capture · live browser";
  }
  return "Capture · pending";
}

export function NodeCard({
  node,
  status,
  surface,
  lastEventAt,
  latestWork,
  commentary,
  selected = false,
  onSelect,
  onOpenTakeover,
  children,
}: NodeCardProps) {
  const badge = surfaceBadge(surface, lastEventAt);
  const statusLabel = STATUS_LABEL[status];

  const handleSelect = () => onSelect?.(node.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelect();
    }
  };

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    // The card's own click selects it; the Open affordance is a distinct
    // action and must not also fire that selection.
    event.stopPropagation();
    onOpenTakeover?.(node.id);
  };

  return (
    <article
      className={styles.card}
      data-status={status}
      data-selected={selected || undefined}
      aria-label={`${node.codename}, ${node.roleLabel}. ${statusLabel}.`}
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.tabStrip}>
        <div className={styles.tab}>
          <span className={styles.codename}>{node.codename}</span>
          <i className={styles.tabDot} aria-hidden="true">
            &middot;
          </i>
          <span className={styles.roleLabel} title={node.roleLabel}>{node.roleLabel}</span>
        </div>
      </div>

      <div className={styles.chrome}>
        <div className={styles.addressBar}>
          <span className={styles.trafficLights} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.badge}>{badge}</span>
        </div>

        <div className={styles.body}>
          {children ? (
            <div className={styles.surfaceSlot}>{children}</div>
          ) : (
            <>
              <p className={styles.objective}>{node.objective}</p>
              {status === "running" && !latestWork && (
                <p className={styles.workNote} data-live="true">
                  <span className={styles.workLabel}>working</span>
                  Cardea is on this step now.
                </p>
              )}
              {latestWork && (
                <p className={styles.workNote}>
                  <span className={styles.workLabel}>recorded</span>
                  {latestWork}
                </p>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.state}>
            <i className={styles.stateDot} aria-hidden="true" />
            {statusLabel}
          </span>
          {commentary && <p className={styles.commentary}>{commentary}</p>}
          {onOpenTakeover && (
            <button type="button" className={styles.open} onClick={handleOpen}>
              Open
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
