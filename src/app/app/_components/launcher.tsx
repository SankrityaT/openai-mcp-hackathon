"use client";

import { useEffect, useMemo, useRef, useState, type FormEventHandler, type ReactNode } from "react";
import { formatSalutation, saluteFor } from "@/core/board/greeting";
import styles from "./launcher.module.css";

export type LauncherPhase = "resting" | "working" | "docked";

const MAX_GOAL = 8_000;

export function SendIcon() {
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

/** Non-interactive progress mark for work that has no real abort path. */
function WorkingIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="5.5" strokeDasharray="6 4" />
    </svg>
  );
}

/**
 * The composer's visual shell: frame, aura, tool row, and send slot, with the
 * input region handed in by the caller. The live Launcher renders it as a
 * form around its textarea; the landing page renders it as an inert div
 * around a typed line. One component, one CSS module, zero lookalikes.
 */
export function ComposerShell({
  as = "div",
  onSubmit,
  input,
  send,
}: {
  as?: "div" | "form";
  onSubmit?: FormEventHandler<HTMLFormElement>;
  input: ReactNode;
  send: ReactNode;
}) {
  const body = (
    <>
      {input}
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

        {send}
      </div>
    </>
  );
  if (as === "form") {
    return (
      <form className={styles.composer} onSubmit={onSubmit}>
        {body}
      </form>
    );
  }
  return <div className={styles.composer}>{body}</div>;
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
  mention,
  seed,
  onSubmit,
  onStop,
  stoppable = true,
}: {
  phase: LauncherPhase;
  displayName?: string | null;
  error?: string | null;
  /** A scoped-prompt request: focus the composer, seeding @codename when empty. */
  mention?: { codename: string | null; nonce: number } | null;
  /** A full-text proposal seed: focus the composer and prefill when empty. */
  seed?: { text: string; nonce: number } | null;
  onSubmit: (goal: string) => void;
  onStop: () => void;
  /**
   * False while the in-flight work has no real abort path (a live mission
   * create is a single committed request). The button then shows honest
   * progress instead of a Stop that could not actually stop anything.
   */
  stoppable?: boolean;
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

  // redirect_node and Focus both land here: the composer opens scoped to the
  // node rather than pretending a hidden side effect happened. The value seed
  // is a render-time state adjustment (guarded by the nonce) so no effect
  // cascades; only the DOM focus, an external system, lives in an effect.
  const [seenMentionNonce, setSeenMentionNonce] = useState(0);
  if (mention && mention.nonce !== seenMentionNonce) {
    setSeenMentionNonce(mention.nonce);
    if (mention.codename && value.trim().length === 0) {
      setValue(`@${mention.codename} `);
    }
  }

  // A proposed follow-up arrives as editable text, never as an action: the
  // person reads it, changes it, and only their send makes it real.
  const [seenSeedNonce, setSeenSeedNonce] = useState(0);
  if (seed && seed.nonce !== seenSeedNonce) {
    setSeenSeedNonce(seed.nonce);
    if (value.trim().length === 0) setValue(seed.text);
  }

  useEffect(() => {
    if (!mention || mention.nonce === 0) return;
    areaRef.current?.focus();
  }, [mention]);

  useEffect(() => {
    if (!seed || seed.nonce === 0) return;
    areaRef.current?.focus();
  }, [seed]);

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
    // Sent is sent: the composer clears the way any chat input does, rather
    // than leaving the submitted goal sitting behind the mandate sheet.
    setValue("");
  }

  return (
    <div className={styles.launcher} data-phase={phase}>
      <div className={styles.salutation} aria-hidden={phase !== "resting"}>
        <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} />
        <h1>{salutation ?? " "}</h1>
      </div>

      <ComposerShell
        as="form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        input={
          <>
            <label className="sr-only" htmlFor="board-goal">
              Give Cardea a goal to take on
            </label>
            <textarea
              id="board-goal"
              ref={areaRef}
              className={styles.input}
              value={value}
              rows={1}
              maxLength={MAX_GOAL}
              placeholder="Give Cardea a goal with real moving parts."
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
          </>
        }
        send={
          <button
            type={working ? "button" : "submit"}
            className={styles.send}
            data-working={working || undefined}
            onClick={working && stoppable ? onStop : undefined}
            disabled={(working && !stoppable) || (!working && value.trim().length === 0)}
            aria-label={
              working ? (stoppable ? "Stop planning" : "Opening the mission") : "Send"
            }
          >
            {working && stoppable ? <StopIcon /> : working ? <WorkingIcon /> : <SendIcon />}
          </button>
        }
      />

      {error && (
        <p className={styles.error} role="status">
          {error}
        </p>
      )}
    </div>
  );
}
