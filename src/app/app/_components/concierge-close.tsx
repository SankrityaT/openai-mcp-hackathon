"use client";

import { useState } from "react";
import type { ConciergeBrief } from "./parse-concierge";
import { DebriefCard } from "./debrief-card";
import styles from "./concierge-close.module.css";

/**
 * The Jarvis close: when a buying mission lands, Cardea speaks in first
 * person, the top pick's page is already opening, and the choices are one
 * tap each. Everything the person is not asked to read lives behind the
 * receipts drawer (the full DebriefCard, verbatim). The spoken line and
 * every option come straight from the recorded deliverable; this component
 * never rewrites them.
 */
export function ConciergeClose({
  brief,
  missionTitle,
  nodeCodename,
  fullText,
  activeUrl,
  onOpenOption,
  onRemember,
  onDismiss,
}: {
  brief: ConciergeBrief;
  missionTitle: string;
  nodeCodename: string;
  /** The whole recorded deliverable, for the receipts drawer and copy. */
  fullText: string;
  /** The url currently open in the live browser, highlighting its chip. */
  activeUrl: string | null;
  onOpenOption: (url: string) => void;
  /** Saves a stated taste into memory; absent for guest sessions. */
  onRemember?: (text: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [rememberState, setRememberState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const topPick = brief.options[0] ?? null;
  const remember = async () => {
    if (!onRemember || !topPick || rememberState === "saving" || rememberState === "saved") return;
    setRememberState("saving");
    try {
      await onRemember(`Preference: liked ${topPick.label} when choosing in a mission.`);
      setRememberState("saved");
    } catch {
      setRememberState("failed");
    }
  };

  return (
    <>
      <div className={styles.bubble} role="status">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.mark} src="/images/cardea/logo-mark.png" alt="" width={44} height={44} />
        <div className={styles.speech}>
          <p className={styles.spoken}>{brief.spoken}</p>
          {brief.options.length > 0 && (
            <div className={styles.chips}>
              {brief.options.map((option) => (
                <button
                  key={option.url}
                  type="button"
                  className={styles.chip}
                  data-active={option.url === activeUrl || undefined}
                  onClick={() => onOpenOption(option.url)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <div className={styles.quietRow}>
            <button
              type="button"
              className={styles.receiptsToggle}
              aria-expanded={receiptsOpen}
              onClick={() => setReceiptsOpen((open) => !open)}
            >
              {receiptsOpen ? "hide the receipts" : "the receipts"}
            </button>
            {onRemember && topPick && (
              <button
                type="button"
                className={styles.receiptsToggle}
                disabled={rememberState === "saving" || rememberState === "saved"}
                onClick={() => void remember()}
              >
                {rememberState === "saved"
                  ? "remembered"
                  : rememberState === "saving"
                    ? "remembering"
                    : rememberState === "failed"
                      ? "could not save, try again"
                      : `remember i liked ${topPick.label.toLowerCase()}`}
              </button>
            )}
          </div>
        </div>
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
        </button>
      </div>
      {receiptsOpen && (
        <DebriefCard
          missionTitle={missionTitle}
          nodeCodename={nodeCodename}
          text={fullText}
          onClose={() => setReceiptsOpen(false)}
        />
      )}
    </>
  );
}
