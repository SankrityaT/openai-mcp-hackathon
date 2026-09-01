"use client";

import { useId } from "react";
import styles from "./mandate-sheet.module.css";

export type MandateSheetPlan = {
  title: string;
  summary: string;
  approvalBoundaries: string[];
};

export type MandateSheetMandate = {
  goal: string;
  version: number;
  constraints: unknown[];
  approvedAt?: string | null;
};

export type MandateSheetProps = {
  mandate: MandateSheetMandate;
  /** From the mandate.proposed event. Null before planning output exists. */
  plan: MandateSheetPlan | null;
  /** Default safe capabilities shown as chips. */
  capabilityNames: string[];
  freePassage: boolean;
  onFreePassageChange: (on: boolean) => void;
  approving: boolean;
  /** Appends mandate.approved {version} on the board. */
  onApprove: () => void;
  /** Optional. Reopens the composer. */
  onRevise?: () => void;
};

export type MandateSheetState = "ready" | "approving" | "approved";

/**
 * Pure helper so the sheet's phase is testable and inspectable without
 * reaching into rendered markup: mirrors the data-state attribute the
 * component itself sets.
 */
export function describeMandateState(props: Pick<MandateSheetProps, "mandate" | "plan" | "approving">): MandateSheetState {
  if (props.mandate.approvedAt) return "approved";
  if (props.approving) return "approving";
  // A missing plan is the normal resting state: planning is dispatched by the
  // approval itself, so nothing is "drafting" before the person approves.
  return "ready";
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 10.5 8 14l7.5-8.5" />
    </svg>
  );
}

function SpinnerIcon() {
  return <i className={styles.spinner} aria-hidden="true" />;
}

/**
 * The Cardea mandate sheet: what a person reviews to move a mission from
 * draft to approved. Approval is the only path that dispatches planning, so
 * this component never implies a mandate is active until `approvedAt` is
 * actually set by the server.
 */
export function MandateSheet(props: MandateSheetProps) {
  const { mandate, plan, capabilityNames, freePassage, onFreePassageChange, approving, onApprove, onRevise } = props;
  const state = describeMandateState(props);
  const headingId = useId();

  if (state === "approved") {
    return (
      <div className={styles.collapsed} data-state={state} role="status">
        <CheckIcon />
        <span className={styles.collapsedGoal}>{truncate(mandate.goal, 72)}</span>
        <span className={styles.collapsedMeta}>Approved, v{mandate.version}</span>
      </div>
    );
  }

  return (
    <section className={styles.sheet} data-state={state} aria-labelledby={headingId}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Mandate</p>
        <h2 id={headingId} className={styles.goal}>
          {mandate.goal}
        </h2>
      </header>

      {/* Everything between the header and the footer scrolls on its own, so a
          long capability list can never push "Approve the mandate" out of
          reach. The footer is the primary action and stays on screen. */}
      <div className={styles.body}>
        {mandate.constraints.length > 0 || capabilityNames.length > 0 ? (
          <ul className={styles.chips}>
            {mandate.constraints.map((constraint, index) => (
              <li key={`constraint-${index}`} className={styles.chip}>
                <span>{describeConstraint(constraint)}</span>
              </li>
            ))}
            {capabilityNames.map((name) => (
              <li key={name} className={styles.chip} data-variant="capability">
                <span>{name}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className={styles.plan}>
          {plan === null ? (
            <p className={styles.drafting}>Planning begins after you approve.</p>
          ) : (
            <div className={styles.planReady}>
              <h3 className={styles.planTitle}>{plan.title}</h3>
              <p className={styles.planSummary}>{plan.summary}</p>
              {plan.approvalBoundaries.length > 0 && (
                <div className={styles.boundaries}>
                  <p className={styles.boundariesLabel}>Requires your approval</p>
                  <ul>
                    {plan.approvalBoundaries.map((boundary, index) => (
                      <li key={index}>{boundary}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.authority}>
          <p className={styles.authorityStatement}>
            Cardea prepares freely and commits nothing without your approval.
          </p>
          <FreePassageToggle on={freePassage} onChange={onFreePassageChange} />
          {freePassage && (
            <p className={styles.scope}>
              Only inside the listed boundaries. Payments, signatures, and account changes still stop for you.
            </p>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        {onRevise && (
          <button type="button" className={styles.revise} onClick={onRevise} disabled={approving}>
            Revise
          </button>
        )}
        <button
          type="button"
          className={styles.approve}
          onClick={onApprove}
          disabled={approving}
          data-approving={approving || undefined}
        >
          {approving && <SpinnerIcon />}
          Approve the mandate
        </button>
      </footer>
    </section>
  );
}

function FreePassageToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className={styles.freePassageRow}>
      <span className={styles.freePassageLabel} id="free-passage-label">
        Free passage
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="free-passage-label"
        className={styles.switch}
        data-on={on || undefined}
        onClick={() => onChange(!on)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(false);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onChange(true);
          }
        }}
      >
        <span className={styles.switchKnob} aria-hidden="true" />
      </button>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

/**
 * The two shapes the product actually writes are `contextCard` (a wallet pass
 * carried in at create) and `instruction` (a scoped change proposed later,
 * including by an agent through `update_mandate`). Both used to fall through
 * to the JSON fallback and render as a raw blob on the one screen a person
 * reads before granting authority, so both are named here explicitly. The
 * fallback stays for genuinely unknown shapes, because showing something is
 * better than showing nothing on a mandate.
 */
function describeConstraint(constraint: unknown): string {
  if (typeof constraint === "string") return constraint;
  if (constraint && typeof constraint === "object") {
    const record = constraint as Record<string, unknown>;
    if (typeof record.contextCard === "string") return `${record.contextCard} pass`;
    if (typeof record.instruction === "string") return record.instruction;
    if (typeof record.label === "string") return record.label;
    if (typeof record.description === "string") return record.description;
  }
  try {
    return JSON.stringify(constraint);
  } catch {
    return String(constraint);
  }
}
