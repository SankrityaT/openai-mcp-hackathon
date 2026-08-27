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

/** Cards in the fan. More than this reads as clutter, not a hand. */
const VISIBLE_CARDS = 5;

export function WalletStack({ passes, holderName, onOpen }: WalletStackProps) {
  if (passes.length === 0) return null;

  // The top of the deck is the first selected pass, falling back to the first
  // pass. The card a person is currently acting under is the one worth seeing.
  const top = passes.find((entry) => entry.selected) ?? passes[0];
  const fan = [...passes.filter((entry) => entry !== top).slice(0, VISIBLE_CARDS - 1), top];
  const centre = (fan.length - 1) / 2;
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
        {fan.map((entry, index) => (
          <div
            key={entry.pass.id}
            className={styles.cardSlot}
            data-top={entry === top || undefined}
            style={
              {
                // Signed distance from the fan's centre drives both the
                // resting lean and the fanned splay, so cards fold back into
                // exactly the pile they came from.
                "--k": String(index - centre),
                "--abs-k": String(Math.abs(index - centre)),
                // Positive-only splay so the hand fans up and to the right
                // out of the corner; the front card stays upright.
                "--spread": String((fan.length - 1 - index) * 10),
                "--depth": String(fan.length - 1 - index),
                "--d": `${index * 40}ms`,
              } as CSSProperties
            }
          >
            <PassCard
              pass={entry.pass}
              holderName={holderName}
              amountUsd={entry.amountUsd}
              selected={entry.selected}
              compact
            />
          </div>
        ))}
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
