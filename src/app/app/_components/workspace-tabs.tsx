"use client";

/**
 * The workspace strip: one tab per mission this person has open, plus a "+"
 * for an empty one.
 *
 * Presentational only. It renders the tabs it is handed and reports clicks;
 * every rule about which tab exists, which is active, and what a key may be
 * lives in `workspace-tabs-state.ts` where it is tested.
 */

import { useRef, useState } from "react";
import type { WorkspaceTab } from "./workspace-tabs-state";
import styles from "./workspace-tabs.module.css";

/** Long enough to tell two missions apart, short enough that ten tabs fit. */
const TITLE_LIMIT = 24;

function truncate(title: string): string {
  return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title;
}

/**
 * Three readings, not seven. A status dot is a glance, so the mission
 * statuses collapse to finished, went wrong, and still going.
 */
function toneFor(status: string): "done" | "failed" | "open" {
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  return "open";
}

export function WorkspaceTabs(props: {
  tabs: readonly WorkspaceTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onNewWorkspace: () => void;
}) {
  const { tabs, activeKey, onSelect, onNewWorkspace } = props;
  const listRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the strip is one Tab stop, and the arrow keys move
  // between the tabs inside it. `focusKey` is only ever set from a real
  // interaction, so this needs no effect to stay in step with `activeKey`;
  // a key that no longer exists simply falls back to the active tab.
  const [focusKey, setFocusKey] = useState(activeKey);

  const keys = [...tabs.map((tab) => tab.key), "new"];
  const focused = keys.includes(focusKey) ? focusKey : activeKey;

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = keys.indexOf(focused);
    const next =
      event.key === "Home"
        ? keys[0]
        : event.key === "End"
          ? keys[keys.length - 1]
          : keys[(index + step + keys.length) % keys.length];
    setFocusKey(next);
    // Moved imperatively rather than through an effect: the elements are
    // already mounted, so this only changes which one holds focus.
    listRef.current
      ?.querySelector<HTMLElement>(`[data-workspace-key="${CSS.escape(next)}"]`)
      ?.focus();
  }

  return (
    <div
      ref={listRef}
      className={styles.strip}
      role="tablist"
      aria-label="Workspaces"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {/* The tabs scroll; the "+" does not. A presentational wrapper is the
          cheapest way to say that, and it leaves the tabs owned by the
          tablist as far as assistive technology is concerned. */}
      <div className={styles.scroller} role="none">
        {tabs.map((tab) => {
          const selected = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              data-workspace-key={tab.key}
              className={styles.tab}
              aria-selected={selected}
              tabIndex={tab.key === focused ? 0 : -1}
              title={tab.title}
              onClick={() => {
                setFocusKey(tab.key);
                onSelect(tab.key);
              }}
            >
              <span
                className={styles.dot}
                data-tone={tab.missionId === null ? "draft" : toneFor(tab.status)}
                aria-hidden="true"
              />
              <span className={styles.label}>{truncate(tab.title)}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        role="tab"
        data-workspace-key="new"
        className={styles.add}
        aria-label="New workspace"
        aria-selected={false}
        tabIndex={focused === "new" ? 0 : -1}
        onClick={() => {
          setFocusKey("new");
          onNewWorkspace();
        }}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
