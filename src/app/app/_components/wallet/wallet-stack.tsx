"use client";

import type { CSSProperties } from "react";
import styles from "./wallet-stack.module.css";
import { PassCard } from "./pass-card";
import {
  MICROUNITS_PER_USD,
  type StarterPass,
  formatPassAmount,
  toBudgetMicrounits,
} from "@/core/board/passes";

/**
 * The wallet as it rests on the board: a compact physical stack, not a list.
 *
 * Only the top pass shows its face. The rest are the edges of cards behind it,
 * fanned by a degree or two so the deck reads as a real object with depth. One
 * target opens the whole thing, because at this size there is nothing to
 * choose between, only a wallet to open.
 */

export type WalletPassState = {
  pass: StarterPass;
  amountUsd: number;
  selected: boolean;
};

export type WalletStackProps = {
  passes: readonly WalletPassState[];
  holderName: string | null;
  onOpen: () => void;
};

/** Card edges drawn behind the face. More than this reads as clutter. */
const VISIBLE_EDGES = 3;

export function WalletStack({ passes, holderName, onOpen }: WalletStackProps) {
  if (passes.length === 0) return null;

  // The top of the deck is the first selected pass, falling back to the first
  // pass. The card a person is currently acting under is the one worth seeing.
  const top = passes.find((entry) => entry.selected) ?? passes[0];
  const behind = passes.filter((entry) => entry !== top).slice(0, VISIBLE_EDGES);
  const selectedCount = passes.filter((entry) => entry.selected).length;
  const loadedMicrounits = passes.reduce(
    (sum, entry) => sum + toBudgetMicrounits(entry.amountUsd),
    0,
  );

  return (
    /*
     * The opener is a real button laid over the stack rather than a button
     * wrapping it: a card face is built from divs and an image, which a button
     * is not allowed to contain.
     */
    <div className={styles.stack}>
      <div className={styles.deck}>
        {behind.map((entry, index) => (
          <div
            key={entry.pass.id}
            className={styles.edge}
            style={
              {
                "--depth": String(behind.length - index),
                "--lean": `${(behind.length - index) % 2 === 0 ? 1.6 : -1.6}deg`,
              } as CSSProperties
            }
            aria-hidden="true"
          />
        ))}
        <div className={styles.face}>
          <PassCard
            pass={top.pass}
            holderName={holderName}
            amountUsd={top.amountUsd}
            selected={top.selected}
            compact
          />
        </div>
        {passes.length > 5 && (
          <span className={styles.count}>
            {passes.length}
            <span className={styles.countUnit}> passes</span>
          </span>
        )}
      </div>

      {/* State in words as well as in the picture: a fan of card edges alone
          cannot say how many passes are live or what they carry. */}
      <div className={styles.caption}>
        <span className={styles.captionTitle}>Context wallet</span>
        <span className={styles.captionMeta}>
          {selectedCount} of {passes.length} selected
          {loadedMicrounits > 0 &&
            `, ${formatPassAmount(loadedMicrounits / MICROUNITS_PER_USD)} loaded`}
        </span>
      </div>

      <button type="button" className={styles.openHit} aria-label="Context wallet" onClick={onOpen} />
    </div>
  );
}
