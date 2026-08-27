"use client";

import { formatPassAmount } from "@/core/board/passes";
import styles from "./budget-flag.module.css";

/**
 * The budget-stop flag: Cardea's honest report that a step would have
 * committed more virtual money than the wallet passes carry, and that it
 * stopped before committing anything.
 *
 * Presentational and layout-agnostic. The board derives `attemptedUsd` and
 * `loadedUsd` from `deriveBudgetFlag` (see `derive-budget-flag.ts`) and
 * mounts this inside a wrapper class that positions it as a floating card
 * near the bottom of the canvas; this component owns none of that
 * positioning.
 */

export type BudgetFlagProps = {
  /** The node that hit the boundary, for example "Lyra" or "Housing". */
  nodeCodename: string;
  /** What the step would have committed, in dollars. */
  attemptedUsd: number;
  /** What the wallet passes currently carry, in dollars. */
  loadedUsd: number;
  /** Opens the wallet so the person can raise the boundary. */
  onOpenWallet: () => void;
  /** Redirects the mission to proceed without spending past the boundary. */
  onPivot: () => void;
  /** Quietly dismisses the flag without changing anything. */
  onDismiss: () => void;
};

function HingeIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 2.5v6.25M10 11.25v6.25M4.5 10h11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

export function BudgetFlag({
  nodeCodename,
  attemptedUsd,
  loadedUsd,
  onOpenWallet,
  onPivot,
  onDismiss,
}: BudgetFlagProps) {
  const attempted = formatPassAmount(attemptedUsd);
  const loaded = formatPassAmount(loadedUsd);

  return (
    <div className={styles.flag} role="status" data-boundary="cost">
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss budget notice"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <header className={styles.header}>
        <span className={styles.badge}>
          <HingeIcon />
          Wallet boundary reached
        </span>
      </header>

      <p className={styles.message}>
        <strong>{nodeCodename}</strong> needed more than your passes carry, so Cardea stopped before
        committing anything.
      </p>

      <dl className={styles.amounts}>
        <div className={styles.amount}>
          <dt>This step needed</dt>
          <dd>{attempted}</dd>
        </div>
        <div className={styles.amount}>
          <dt>Your wallet carries</dt>
          <dd>{loaded}</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onOpenWallet}>
          Load the wallet
        </button>
        <button type="button" className={styles.secondary} onClick={onPivot}>
          Continue without spending
        </button>
      </div>
    </div>
  );
}
