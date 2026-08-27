"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import styles from "./wallet-surface.module.css";
import { PassCard } from "./pass-card";
import { type StarterPass, formatPassAmount } from "@/core/board/passes";

/**
 * The wallet opened: every pass at full size above a dimmed canvas, each one
 * selectable and loadable in place.
 *
 * Dialog behaviour follows `takeover-panel.tsx`, which is the board's existing
 * pattern for a surface that takes over judgment: a dimmed, blurred backdrop,
 * `role="dialog"` with `aria-modal`, Escape to close, click outside to close,
 * and Tab trapped inside while it is open.
 */

export type WalletSurfaceProps = {
  open: boolean;
  holderName: string | null;
  passes: readonly StarterPass[];
  selectedIds: readonly string[];
  amounts: Readonly<Record<string, number>>;
  totalLoadedUsd: number;
  onToggle: (id: string) => void;
  onLoad: (id: string, amountUsd: number) => void;
  onClose: () => void;
};

export function WalletSurface({
  open,
  holderName,
  passes,
  selectedIds,
  amounts,
  totalLoadedUsd,
  onToggle,
  onLoad,
  onClose,
}: WalletSurfaceProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingId = "wallet-surface-title";

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const selectedCount = passes.filter((pass) => selectedIds.includes(pass.id)).length;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={trapTab}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 id={headingId} className={styles.title}>
              Context wallet
            </h2>
            <p className={styles.lede}>
              Passes carry the memory, apps, and spending boundary a mission may use.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close context wallet"
          >
            ×
          </button>
        </header>

        <ul className={styles.deck}>
          {passes.map((pass) => (
            <li key={pass.id} className={styles.slot}>
              <PassCard
                pass={pass}
                holderName={holderName}
                amountUsd={amounts[pass.id] ?? 0}
                selected={selectedIds.includes(pass.id)}
                onSelect={() => onToggle(pass.id)}
                onLoad={(amount) => onLoad(pass.id, amount)}
              />
              <p className={styles.description}>{pass.description}</p>
            </li>
          ))}
        </ul>

        <footer className={styles.footer}>
          <span>
            {selectedCount} of {passes.length} passes selected
          </span>
          <span className={styles.total}>{formatPassAmount(totalLoadedUsd)} loaded in total</span>
        </footer>
      </div>
    </div>
  );
}
