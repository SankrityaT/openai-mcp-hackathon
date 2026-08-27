"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./canvas.module.css";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Minimal functional sign-in for live mode: an email magic link through the
 * existing browser Supabase client. The callback route already completes the
 * exchange. This is deliberately not a visual design; the later rebuild owns
 * the final treatment.
 */
export function SignInPanel({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [judgeStatus, setJudgeStatus] = useState<Status>("idle");
  const [judgeCode, setJudgeCode] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (address.length < 3 || address.length > 320 || !address.includes("@")) {
      setStatus("error");
      setMessage("Enter the email address you want the sign-in link sent to.");
      return;
    }
    setStatus("sending");
    try {
      const client = createSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/canvas`,
        },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Check your email for a Cardea sign-in link, then return to this tab.");
    } catch {
      setStatus("error");
      setMessage(
        "Cardea could not send a sign-in link. Authentication may not be configured in this deployment.",
      );
    }
  }

  async function redeemJudgeAccess(event: FormEvent) {
    event.preventDefault();
    const code = judgeCode.trim();
    if (code.length < 8 || code.length > 200) {
      setJudgeStatus("error");
      setMessage("Enter the judge access code provided with the submission.");
      return;
    }
    setJudgeStatus("sending");
    try {
      const response = await fetch("/api/judge/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error("invalid_code");
      setJudgeStatus("sent");
      setMessage("Judge access is active for this browser.");
      onSignedIn();
    } catch {
      setJudgeStatus("error");
      setMessage("That judge code could not be redeemed.");
    }
  }

  return (
    <section
      className={styles.walletOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-title"
    >
      <button
        className={styles.walletBackdrop}
        type="button"
        aria-label="Close sign in"
        onClick={onClose}
      />
      <div className={`${styles.walletPanel} ${styles.accessPanel}`}>
        <header>
          <div>
            <span className={styles.eyebrow}>Cardea session</span>
            <h2 id="sign-in-title">Sign in to work on real missions.</h2>
          </div>
          <button type="button" aria-label="Close sign in" onClick={onClose}>
            ×
          </button>
        </header>
        <p>
          Live mode persists missions, events, and decisions to your own tenant. Until you
          sign in, the canvas shows representative fixture state and records nothing.
        </p>
        <form className={styles.accessForm} onSubmit={(event) => void submit(event)}>
          <label className={styles.srOnly} htmlFor="cardea-signin-email">
            Email address
          </label>
          <input
            id="cardea-signin-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" className={styles.primaryButton} disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
        <div className={styles.accessDivider}><span>or</span></div>
        <form className={styles.accessForm} onSubmit={(event) => void redeemJudgeAccess(event)}>
          <label htmlFor="cardea-judge-code">Hackathon judge access</label>
          <div>
            <input
              id="cardea-judge-code"
              type="password"
              autoComplete="off"
              placeholder="Submission access code"
              value={judgeCode}
              onChange={(event) => setJudgeCode(event.target.value)}
            />
            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={judgeStatus === "sending"}
            >
              {judgeStatus === "sending" ? "Checking…" : "Use judge access"}
            </button>
          </div>
        </form>
        {message && <p role="status">{message}</p>}
        <footer>
          <span>Magic link · no password stored</span>
          <button type="button" onClick={onSignedIn}>
            I have signed in
          </button>
        </footer>
      </div>
    </section>
  );
}
