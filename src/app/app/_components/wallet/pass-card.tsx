"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./pass-card.module.css";
import {
  MAX_PASS_AMOUNT_USD,
  type StarterPass,
  formatPassAmount,
  toBudgetMicrounits,
  MICROUNITS_PER_USD,
} from "@/core/board/passes";

/**
 * One context pass: printed transit-card artwork sealed inside a dimensional
 * enamel-edged shell.
 *
 * Anatomy, in the order a person reads it:
 *   - the artwork, full bleed at the 1.586 transit-card ratio;
 *   - a slim translucent hairline strip at the top carrying issuer identity
 *     (mark, wordmark) and the domain label;
 *   - the holder line and the loaded boundary along the bottom, sitting in the
 *     lower band each artwork was composed to keep calm, so the scrim there
 *     can stay faint instead of blanking out the picture.
 *
 * Purely presentational. It owns no wallet state, only the transient state of
 * its own amount chooser, and reports every change through `onSelect` and
 * `onLoad`.
 */

/** Card face aspect. Locked to the artwork and to the transit-card reference. */
const CARD_RATIO = 1.586;

/** Restrained: enough parallax to feel like an object, never a toy. */
const MAX_TILT_DEG = 4;

const PRESETS = [25, 50, 100, 250] as const;

export type PassCardProps = {
  pass: StarterPass;
  holderName: string | null;
  amountUsd: number;
  selected: boolean;
  onSelect?: () => void;
  onLoad?: (amount: number) => void;
  compact?: boolean;
};

/**
 * Tilt is only offered where it is a real gyroscopic response to a real
 * pointer. Touch has no hover to respond to, and reduced motion means a person
 * asked for a still interface, so both get a static card.
 *
 * Read through `useSyncExternalStore` rather than state plus an effect: the
 * answer is a browser fact that can change mid-session, this is the API that
 * subscribes to it without a setState-in-effect, and its server snapshot keeps
 * the card safe to render on the server as well as on the client-only board.
 */
const TILT_QUERIES = ["(hover: hover) and (pointer: fine)", "(prefers-reduced-motion: reduce)"];

function subscribeTilt(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const lists = TILT_QUERIES.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function detectTilt(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const [pointer, reducedMotion] = TILT_QUERIES;
  return (
    window.matchMedia(pointer).matches && !window.matchMedia(reducedMotion).matches
  );
}

export function PassCard({
  pass,
  holderName,
  amountUsd,
  selected,
  onSelect,
  onLoad,
  compact = false,
}: PassCardProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const tiltEnabled = useSyncExternalStore(subscribeTilt, detectTilt, () => false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chooserId = useId();

  const clearTilt = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pendingRef.current = null;
    const frame = frameRef.current;
    if (!frame) return;
    frame.style.setProperty("--tilt-x", "0deg");
    frame.style.setProperty("--tilt-y", "0deg");
    frame.style.setProperty("--glare", "0");
  }, []);

  useEffect(() => clearTilt, [clearTilt]);

  /**
   * Pointer position is written straight to CSS custom properties inside one
   * rAF frame. Routing it through React state instead would re-render the card
   * on every pointer sample, which is how a restrained tilt turns into jank on
   * a board holding several of them.
   */
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!tiltEnabled || event.pointerType !== "mouse") return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pendingRef.current = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const point = pendingRef.current;
      const element = frameRef.current;
      if (!point || !element) return;
      // Away from centre in each axis, mapped to a small opposing rotation.
      element.style.setProperty("--tilt-y", `${(point.x - 0.5) * 2 * MAX_TILT_DEG}deg`);
      element.style.setProperty("--tilt-x", `${(0.5 - point.y) * 2 * MAX_TILT_DEG}deg`);
      element.style.setProperty("--glare-x", `${point.x * 100}%`);
      element.style.setProperty("--glare-y", `${point.y * 100}%`);
      element.style.setProperty("--glare", "1");
    });
  }

  function commitDraft(event: FormEvent) {
    event.preventDefault();
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) return;
    onLoad?.(toBudgetMicrounits(parsed) / MICROUNITS_PER_USD);
    setChooserOpen(false);
    setDraft("");
  }

  function choosePreset(value: number) {
    onLoad?.(value);
    setChooserOpen(false);
    setDraft("");
  }

  const holderLabel = holderName ?? "Guest pass";
  const amountLabel = formatPassAmount(amountUsd);
  const loaded = toBudgetMicrounits(amountUsd) > 0;

  return (
    <div
      ref={frameRef}
      className={styles.frame}
      data-compact={compact || undefined}
      data-tilt={tiltEnabled || undefined}
      data-domain={pass.domain}
      style={{ aspectRatio: String(CARD_RATIO) }}
      onPointerMove={onPointerMove}
      onPointerLeave={clearTilt}
    >
      <div className={styles.shell}>
        <Image
          className={styles.art}
          src={pass.art}
          alt=""
          fill
          sizes={compact ? "200px" : "(max-width: 720px) 90vw, 340px"}
          priority={false}
        />

        {/*
          The select target is a real button laid over the artwork, beneath the
          controls in the strips. A card cannot be a button that contains
          buttons, and a div with a role would lose the native keyboard and
          pressed-state behaviour this needs.
        */}
        {onSelect && (
          <button
            type="button"
            className={styles.selectHit}
            aria-pressed={selected}
            aria-label={`${pass.label} pass, ${loaded ? `${amountLabel} loaded` : "no amount loaded"}`}
            onClick={onSelect}
          />
        )}

        <div className={styles.topStrip}>
          <Image
            className={styles.mark}
            src="/images/cardea/logo-mark.png"
            alt=""
            width={36}
            height={36}
          />
          <span className={styles.wordmark}>Cardea</span>
          {selected && (
            /* Selection is carried by the ring, this marker, and aria-pressed
               together, so colour is never the only thing saying it. */
            <span className={styles.selectedMark}>
              <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path
                  d="M2.5 6.4 4.9 8.8 9.6 3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Selected
            </span>
          )}
          <span className={styles.domainLabel}>{pass.label} pass</span>
        </div>

        <div className={styles.bottomStrip}>
          <span className={styles.holder} data-guest={holderName ? undefined : true}>
            {holderLabel}
          </span>
          {/*
            The balance is the control. A separate pill beside it would put two
            things where a person already reads one, so the figure itself opens
            the chooser: quiet at rest, an underline and a plus on hover or
            focus, and a plus that stays put where there is no hover to give.
          */}
          {onLoad && !compact ? (
            <button
              type="button"
              className={styles.amountButton}
              data-empty={loaded ? undefined : true}
              aria-label="Load this pass"
              aria-expanded={chooserOpen}
              aria-controls={chooserId}
              onClick={() => setChooserOpen((open) => !open)}
            >
              <span className={styles.amount}>{amountLabel}</span>
              <span className={styles.plus} aria-hidden="true">
                +
              </span>
            </button>
          ) : (
            <span className={styles.amount}>{amountLabel}</span>
          )}
        </div>

        {chooserOpen && onLoad && (
          <form
            id={chooserId}
            className={styles.chooser}
            onSubmit={commitDraft}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              setChooserOpen(false);
            }}
          >
            <div className={styles.presets}>
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={styles.preset}
                  onClick={() => choosePreset(preset)}
                >
                  {formatPassAmount(preset)}
                </button>
              ))}
            </div>
            <div className={styles.customRow}>
              <span className={styles.customField}>
                <span className={styles.currencyMark} aria-hidden="true">
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={MAX_PASS_AMOUNT_USD}
                  step="0.01"
                  value={draft}
                  autoFocus
                  aria-label={`Amount the ${pass.label} pass may spend, in dollars`}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </span>
              <button type="submit" className={styles.confirm} disabled={draft.trim() === ""}>
                Confirm
              </button>
              <button
                type="button"
                className={styles.chooserClose}
                onClick={() => setChooserOpen(false)}
              >
                Cancel
              </button>
            </div>
            {/* What the control does and the field's real bound. What approval
                a spend then needs is stated in the mandate sheet, where it is
                reviewable, never as a caption on a card. */}
            <p className={styles.chooserNote}>
              Virtual planning limit, up to {formatPassAmount(MAX_PASS_AMOUNT_USD)}. Not real
              money: nothing is charged and nothing can be spent.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
