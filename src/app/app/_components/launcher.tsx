"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatSalutation, saluteFor } from "@/core/board/greeting";
import styles from "./launcher.module.css";

export type LauncherPhase = "resting" | "working" | "docked";

const MAX_GOAL = 8_000;

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 16V5M5.5 9.5 10 5l4.5 4.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6.5" y="6.5" width="7" height="7" rx="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The single entry point to the board: a salutation and composer resting in
 * the middle of the sheet, which travels to a dock at the bottom once a
 * mission begins. Position is animated as one transform on this wrapper so the
 * move is compositor-cheap and never reflows the board underneath it.
 */
export function Launcher({
  phase,
  displayName,
  error,
  onSubmit,
  onStop,
}: {
  phase: LauncherPhase;
  displayName?: string | null;
  error?: string | null;
  onSubmit: (goal: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Safe to read the clock during render: the board never renders on the
  // server, so there is no markup for a time-of-day greeting to mismatch.
  const salutation = useMemo(
    () => formatSalutation(saluteFor(new Date(), displayName)),
    [displayName],
  );

  useEffect(() => {
    if (phase === "resting") areaRef.current?.focus();
  }, [phase]);

  // Grow with the content rather than scrolling a fixed box.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
  }, [value]);

  const working = phase === "working";

  function submit() {
    const goal = value.trim();
    if (goal.length === 0 || working) return;
    onSubmit(goal.slice(0, MAX_GOAL));
  }

  return (
    <div className={styles.launcher} data-phase={phase}>
      <div className={styles.salutation} aria-hidden={phase !== "resting"}>
        <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} />
        <h1>{salutation ?? " "}</h1>
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="board-goal">
          Tell Cardea what needs to change
        </label>
        <textarea
          id="board-goal"
          ref={areaRef}
          className={styles.input}
          value={value}
          rows={1}
          maxLength={MAX_GOAL}
          placeholder="Tell Cardea what needs to change."
          spellCheck={false}
          disabled={working}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline, as in every composer
            // people already have muscle memory for.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <div className={styles.controls}>
          <div className={styles.tools}>
            <button type="button" title="Attach files (not yet wired)" disabled aria-label="Attach files">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
            </button>
            <button type="button" title="Tag a source (not yet wired)" disabled aria-label="Tag a source">
              <span className={styles.glyph}>@</span>
            </button>
            <button type="button" title="Run a command (not yet wired)" disabled aria-label="Run a command">
              <span className={styles.glyph}>/</span>
            </button>
          </div>

          <p className={styles.authority}>
            Prepares freely &middot; asks before it commits
          </p>

          <button
            type={working ? "button" : "submit"}
            className={styles.send}
            data-working={working || undefined}
            onClick={working ? onStop : undefined}
            disabled={!working && value.trim().length === 0}
            aria-label={working ? "Stop planning" : "Send"}
          >
            {working ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
      </form>

      {error && (
        <p className={styles.error} role="status">
          {error}
        </p>
      )}
    </div>
  );
}
