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
  onOpenUrl,
  onClose,
}: {
  missionTitle: string;
  nodeCodename: string;
  text: string;
  /** Opens a live browser on the brief's order or booking page. */
  onOpenUrl?: (url: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // The verdict is the first non-empty line; the first evidence url is the
  // road to checkout. Both come verbatim from the recorded deliverable.
  const lines = text.split("\n");
  const verdict = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const rest = text.slice(text.indexOf(verdict) + verdict.length).trim();
  const orderUrl = text.match(/https?:\/\/[^\s)\]]+/)?.[0] ?? null;

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
        <p className={styles.verdict}>{verdict}</p>
        {rest && <p className={styles.text}>{rest}</p>}
      </div>
      <footer className={styles.foot}>
        {orderUrl && onOpenUrl && (
          <button type="button" className={styles.order} onClick={() => onOpenUrl(orderUrl)}>
            Open the order page
          </button>
        )}
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy the brief"}
        </button>
      </footer>
    </aside>
  );
}
