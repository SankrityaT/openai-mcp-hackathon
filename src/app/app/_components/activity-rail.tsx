"use client";

import { useMemo, useState } from "react";
import type { MissionEvent } from "@/core/contracts/types";
import { describeEventType, eventFamily, type EventFamily } from "@/core/contracts/activity-labels";
import styles from "./activity-rail.module.css";

export type ActivityRailProps = {
  /** Oldest first, bounded (max 200), sourced from the board's ring buffer. */
  events: readonly MissionEvent[];
  /** nodeId -> codename. */
  nodeNames: ReadonlyMap<string, string>;
  open: boolean;
  onClose: () => void;
  onFocusNode?: (nodeId: string) => void;
};

type ChipFamily = "all" | EventFamily;

const CHIPS: ReadonlyArray<{ id: ChipFamily; label: string }> = [
  { id: "all", label: "All" },
  { id: "nodes", label: "Nodes" },
  { id: "tools", label: "Tools" },
  { id: "evidence", label: "Evidence" },
  { id: "approvals", label: "Approvals" },
];

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Approval-family rows, and any row carrying a nodeId, are clickable. */
function isRowFocusable(event: MissionEvent): boolean {
  return Boolean(event.nodeId) || eventFamily(event.type) === "approvals";
}

export function ActivityRail({ events, nodeNames, open, onClose, onFocusNode }: ActivityRailProps) {
  const [filter, setFilter] = useState<ChipFamily>("all");

  const rows = useMemo(() => {
    const filtered =
      filter === "all" ? events : events.filter((event) => eventFamily(event.type) === filter);
    // Newest first: the ring buffer arrives oldest first.
    return [...filtered].reverse();
  }, [events, filter]);

  return (
    <aside
      className={styles.rail}
      data-open={open || undefined}
      aria-hidden={!open}
      aria-label="Activity"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Activity</h2>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close activity">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </header>

      <div className={styles.chips} role="group" aria-label="Filter activity">
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={styles.chip}
            aria-pressed={filter === chip.id}
            data-active={filter === chip.id || undefined}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {rows.length === 0 ? (
          <p className={styles.empty}>Nothing has happened yet.</p>
        ) : (
          <ul className={styles.rowList}>
            {rows.map((event) => {
              const nodeName = event.nodeId ? nodeNames.get(event.nodeId) : undefined;
              const focusable = isRowFocusable(event) && Boolean(event.nodeId) && Boolean(onFocusNode);
              const body = (
                <>
                  <span className={styles.rowLabel}>{describeEventType(event.type)}</span>
                  {nodeName ? <span className={styles.rowNode}>{nodeName}</span> : null}
                  {event.trust === "untrusted" ? <span className={styles.untrustedTag}>untrusted</span> : null}
                </>
              );

              return (
                <li key={event.id} className={styles.row}>
                  <span className={styles.rowMeta}>
                    <span className={styles.sequence}>{`#${event.sequence}`}</span>
                    <time className={styles.timestamp} dateTime={event.createdAt}>
                      {formatClock(event.createdAt)}
                    </time>
                  </span>
                  {focusable ? (
                    <button
                      type="button"
                      className={styles.rowButton}
                      onClick={() => event.nodeId && onFocusNode?.(event.nodeId)}
                    >
                      {body}
                    </button>
                  ) : (
                    <span className={styles.rowStatic}>{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
