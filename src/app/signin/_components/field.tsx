"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./field.module.css";

/**
 * Cardea text field.
 *
 * Label above in Geist sentence case, never a glyph and a shrunken
 * placeholder crammed inside the control. The label is bound by a generated
 * id so it stays associated without callers inventing one, and `hint` is
 * wired through aria-describedby rather than left as decoration.
 */
export function Field({
  label,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={styles.input}
        aria-describedby={hint ? hintId : props["aria-describedby"]}
      />
      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
