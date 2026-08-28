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
  onDismiss: () => void;
}) {
  const [receiptsOpen, setReceiptsOpen] = useState(false);

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
          <button
            type="button"
            className={styles.receiptsToggle}
            aria-expanded={receiptsOpen}
            onClick={() => setReceiptsOpen((open) => !open)}
          >
            {receiptsOpen ? "hide the receipts" : "the receipts"}
          </button>
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
