"use client";

import { useState } from "react";
import styles from "./debrief-card.module.css";

/**
 * The mission's end result, surfaced instead of buried: when a mission
 * completes, the terminal node's recorded deliverable is presented as one
 * readable brief. Content comes verbatim from the mission's own evidence
 * events; this card never rewrites or summarizes it.
 */
export function DebriefCard({
  missionTitle,
  nodeCodename,
  text,
  onClose,
}: {
  missionTitle: string;
  nodeCodename: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the text stays selectable */
    }
  };

  return (
    <aside className={styles.card} role="region" aria-label="Mission brief">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Mission brief</p>
          <h2 className={styles.title}>{missionTitle}</h2>
          <p className={styles.credit}>Consolidated by {nodeCodename}. Review before acting on it.</p>
        </div>
        <button type="button" className={styles.close} aria-label="Close the brief" onClick={onClose}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
        </button>
      </header>
      <div className={styles.body}>
        <p className={styles.text}>{text}</p>
      </div>
      <footer className={styles.foot}>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy the brief"}
        </button>
      </footer>
    </aside>
  );
}
