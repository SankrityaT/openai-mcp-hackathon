"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./approval-card.module.css";

/**
 * One human-judgment surface for the board.
 *
 * Presentational and props-driven: the board owns the `MissionApproval` record, the resolve
 * request, and any optimistic state. This component only renders the locked "Needs You" anatomy
 * (recommendation, evidence, alternatives, consequence, then Accept, Modify, Reject) and reports
 * the person's decision back through `onResolve`.
 */

const MAX_NOTE_CHARS = 2000;
const MAX_SUMMARY_CHARS = 160;

export type ApprovalCardApproval = {
  id: string;
  category: string;
  recommendation: string;
  alternatives: unknown[];
  evidence: unknown[];
  consequence: string;
  status: string;
};

export type ApprovalCardProps = {
  approval: ApprovalCardApproval;
  resolving: boolean;
  onResolve: (decision: "accept" | "modify" | "reject", note?: string) => void;
  /** Saves a stated preference into memory; absent for guest sessions. */
  onRemember?: (text: string) => Promise<void>;
};

/**
 * Deterministic, non-cryptographic short hash for a telemetry-only id badge. `MissionApproval.id`
 * is not designed to be read at a glance, so this gives the pixel-face row a short stable code
 * without claiming any security property.
 */
function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

function isTrustedFlagUntrusted(record: Record<string, unknown>): boolean {
  const trust = record.trust;
  if (typeof trust === "string") return trust.toLowerCase() === "untrusted";
  if (typeof record.untrusted === "boolean") return record.untrusted;
  return false;
}

function boundedJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text;
}

/** Reduce one evidence or alternative entry to plain display text plus its trust flag. */
function describeEntry(item: unknown): { text: string; untrusted: boolean } {
  if (typeof item === "string") return { text: item, untrusted: false };
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const untrusted = isTrustedFlagUntrusted(record);
    const summary = record.summary;
    if (typeof summary === "string" && summary.trim()) {
      return { text: summary, untrusted };
    }
    return { text: boundedJson(record), untrusted };
  }
  return { text: boundedJson(item), untrusted: false };
}

export function ApprovalCard({ approval, resolving, onResolve, onRemember }: ApprovalCardProps) {
  const [modifying, setModifying] = useState(false);
  const [note, setNote] = useState("");
  // Set only when the note came from clicking a listed alternative, never
  // from the freeform "Modify" button: a picked alternative is a clean
  // "chose X over the suggested Y" fact; a hand-edited correction is not.
  const [pickedAlternative, setPickedAlternative] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const noteId = useId();

  const evidence = approval.evidence.map(describeEntry);
  const alternatives = approval.alternatives.map(describeEntry);

  function openModify() {
    setPickedAlternative(null);
    setRemember(false);
    setModifying(true);
  }

  function selectAlternative(text: string) {
    setNote(text.slice(0, MAX_NOTE_CHARS));
    setPickedAlternative(text);
    setRemember(false);
    setModifying(true);
  }

  function cancelModify() {
    setModifying(false);
    setNote("");
    setPickedAlternative(null);
    setRemember(false);
  }

  function confirmModify(event: FormEvent) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return;
    if (remember && onRemember && pickedAlternative) {
      const fact = `Chose "${trimmed}" over the suggested "${approval.recommendation}" for a ${approval.category} decision.`;
      void onRemember(fact.slice(0, MAX_NOTE_CHARS)).catch(() => undefined);
    }
    onResolve("modify", trimmed);
  }

  return (
    <article className={styles.card} data-resolving={resolving || undefined} aria-busy={resolving}>
      <header className={styles.telemetry}>
        <span>{approval.category}</span>
        <span aria-hidden="true">·</span>
        <span>approval {shortHash(approval.id)}</span>
      </header>

      <p className={styles.recommendation}>{approval.recommendation}</p>

      {evidence.length > 0 && (
        <section className={styles.section} aria-label="Evidence">
          <h3 className={styles.sectionLabel}>Evidence</h3>
          <ul className={styles.evidenceList}>
            {evidence.map((entry, index) => (
              <li key={index}>
                <span>{entry.text}</span>
                {entry.untrusted && <span className={styles.untrustedTag}>untrusted</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {alternatives.length > 0 && (
        <section className={styles.section} aria-label="Alternatives">
          <h3 className={styles.sectionLabel}>Alternatives</h3>
          <ul className={styles.alternativesList}>
            {alternatives.map((entry, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={styles.alternativeOption}
                  onClick={() => selectAlternative(entry.text)}
                  disabled={resolving}
                >
                  <span>{entry.text}</span>
                  {entry.untrusted && <span className={styles.untrustedTag}>untrusted</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className={styles.consequence}>
        <span className={styles.consequenceMark} aria-hidden="true" />
        {approval.consequence}
      </p>

      {modifying ? (
        <form className={styles.modifyForm} onSubmit={confirmModify}>
          <label htmlFor={noteId}>What should change</label>
          <textarea
            id={noteId}
            value={note}
            maxLength={MAX_NOTE_CHARS}
            placeholder="Describe the change Cardea should make before proceeding."
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_CHARS))}
            disabled={resolving}
            autoFocus
          />
          <div className={styles.modifyMeta}>
            <span>{note.length}/{MAX_NOTE_CHARS}</span>
          </div>
          {onRemember && pickedAlternative && (
            <label className={styles.rememberToggle}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={resolving}
              />
              Remember this choice
            </label>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.tertiary} onClick={cancelModify} disabled={resolving}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={resolving || !note.trim()}>
              {resolving ? "Sending…" : "Confirm modification"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => onResolve("accept")}
            disabled={resolving}
          >
            {resolving ? "Working…" : "Accept"}
          </button>
          <button type="button" className={styles.secondary} onClick={openModify} disabled={resolving}>
            Modify
          </button>
          <button
            type="button"
            className={styles.tertiary}
            onClick={() => onResolve("reject")}
            disabled={resolving}
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}
