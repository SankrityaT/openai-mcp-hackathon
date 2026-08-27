"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "./access-gate.module.css";

/**
 * The board's threshold. An anonymous visitor chooses a way in before
 * anything else happens: sign in, spend the single guest run, or redeem the
 * judge code. Nothing is minted or created until they choose.
 */
export function AccessGate({
  onGuest,
  onJudge,
}: {
  onGuest: () => Promise<boolean>;
  onJudge: () => void;
}) {
  const [pending, setPending] = useState<null | "guest" | "judge">(null);
  const [judgeCode, setJudgeCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function chooseGuest() {
    setPending("guest");
    setMessage(null);
    const ok = await onGuest();
    setPending(null);
    if (!ok) setMessage("Cardea could not open a guest session. Try again in a moment.");
  }

  async function redeemJudge(event: FormEvent) {
    event.preventDefault();
    const code = judgeCode.trim();
    if (code.length < 8 || code.length > 200) {
      setMessage("Enter the access code issued with the submission.");
      return;
    }
    setPending("judge");
    setMessage(null);
    try {
      const response = await fetch("/api/judge/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error("invalid_code");
      setJudgeCode("");
      setPending(null);
      onJudge();
    } catch {
      setPending(null);
      // Deliberately generic: a specific reason would help someone guessing.
      setMessage("That access code could not be redeemed.");
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className={styles.panel}>
        <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} className={styles.mark} />
        <h1 className={styles.title} id="gate-title">
          Choose your way in.
        </h1>

        <Link className={styles.signIn} href="/signin?next=/app">
          Sign in to Cardea
        </Link>

        <button
          type="button"
          className={styles.guest}
          onClick={() => void chooseGuest()}
          disabled={pending !== null}
        >
          {pending === "guest" ? "Opening your run" : "Try one mission as a guest"}
        </button>

        <form className={styles.judge} onSubmit={(event) => void redeemJudge(event)}>
          <label className={styles.judgeLabel} htmlFor="gate-judge-code">
            <i aria-hidden="true" />
            Hackathon judge access
          </label>
          <div className={styles.judgeRow}>
            <input
              id="gate-judge-code"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the submission code"
              value={judgeCode}
              onChange={(event) => setJudgeCode(event.target.value)}
            />
            <button type="submit" disabled={pending !== null}>
              {pending === "judge" ? "Checking" : "Enter"}
            </button>
          </div>
        </form>

        {message && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}

        <p className={styles.legal}>
          By continuing you agree to the <Link href="/terms">terms</Link> and{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
