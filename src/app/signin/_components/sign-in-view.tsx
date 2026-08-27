"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Field } from "./field";
import styles from "./sign-in-view.module.css";

type Pending = null | "google" | "email" | "judge" | "guest";
type Message = { tone: "info" | "error"; text: string } | null;

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}

/**
 * Cardea sign-in.
 *
 * Three ranked doors: Google is primary, an email link is the fallback, and
 * the hackathon judge code is a separate lower section that grants access
 * without creating an account at all. Guests need none of them for a single
 * trial mission, which the closing line states plainly.
 *
 * The judge code is only ever POSTed to /api/judge/redeem, which compares it
 * against a stored hash in constant time. It is never persisted, logged, or
 * reflected back into the UI.
 */
export function SignInView({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [judgeCode, setJudgeCode] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);
  const callback = (returnTo: string) =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;

  async function continueWithGoogle() {
    setPending("google");
    setMessage(null);
    try {
      const client = createSupabaseBrowserClient();
      // The browser client uses PKCE, so only a code reaches the callback and
      // the verifier never leaves this origin. No Google secret exists here;
      // the token exchange happens inside Supabase.
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback(next) },
      });
      if (error) throw error;
      // On success the browser is already navigating; keep the button pending.
    } catch (error) {
      setPending(null);
      const detail = error instanceof Error ? error.message : "";
      setMessage({
        tone: "error",
        text: /provider is not enabled|Unsupported provider/i.test(detail)
          ? "Google sign-in is not enabled for this deployment yet. Use an email link instead."
          : "Cardea could not start Google sign-in. Use an email link instead.",
      });
    }
  }

  async function sendEmailLink(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (address.length < 3 || address.length > 320 || !address.includes("@")) {
      setMessage({ tone: "error", text: "Enter the email address to send the sign-in link to." });
      return;
    }
    setPending("email");
    setMessage(null);
    try {
      const client = createSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: callback(next) },
      });
      if (error) throw error;
      setPending(null);
      setMessage({
        tone: "info",
        text: "Check your email for a Cardea sign-in link, then return to this tab.",
      });
    } catch {
      setPending(null);
      setMessage({
        tone: "error",
        text: "Cardea could not send a sign-in link. Authentication may not be configured here.",
      });
    }
  }

  async function continueAsGuest() {
    setPending("guest");
    setMessage(null);
    try {
      const response = await fetch("/api/guest/session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("guest_unavailable");
      window.location.assign(next);
    } catch {
      setPending(null);
      setMessage({
        tone: "error",
        text: "Cardea could not open a guest session. Try again in a moment.",
      });
    }
  }

  async function redeemJudgeAccess(event: FormEvent) {
    event.preventDefault();
    const code = judgeCode.trim();
    if (code.length < 8 || code.length > 200) {
      setMessage({ tone: "error", text: "Enter the access code issued with the submission." });
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
      // Cleared immediately: the code never lingers in component state.
      setJudgeCode("");
      window.location.assign(next);
    } catch {
      setPending(null);
      // Deliberately generic: a specific reason would help someone guessing.
      setMessage({ tone: "error", text: "That access code could not be redeemed." });
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.form}>
        <Link className={styles.brand} href="/">
          <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} />
          <span>Cardea</span>
        </Link>

        <div className={styles.stack}>
          <header className={styles.head}>
            <h1>Your canvas beyond the prompt.</h1>
            <p>Sign in to keep your missions, memory, and connected apps.</p>
          </header>

          <button
            className={styles.google}
            type="button"
            onClick={() => void continueWithGoogle()}
            disabled={pending !== null}
          >
            <span className={styles.googleMark} aria-hidden="true"><GoogleG /></span>
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <div className={styles.divider}>or use an email link</div>

          <form onSubmit={(event) => void sendEmailLink(event)}>
            <Field
              id="cardea-email"
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className={styles.emailSend} type="submit" disabled={pending !== null}>
              {pending === "email" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>

          {message && (
            <p className={styles.message} data-tone={message.tone} role="status">
              {message.text}
            </p>
          )}

          <section className={styles.judge} aria-labelledby="cardea-judge-title">
            <h2 className={styles.judgeTitle} id="cardea-judge-title">
              <i className={styles.judgeDot} aria-hidden="true" />
              Hackathon judge access
            </h2>
            <p className={styles.judgeNote}>
              Ten mission runs with the submission code. No account required.
            </p>
            <form className={styles.judgeRow} onSubmit={(event) => void redeemJudgeAccess(event)}>
              <Field
                id="cardea-judge-code"
                label="Access code"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the submission code"
                value={judgeCode}
                onChange={(event) => setJudgeCode(event.target.value)}
              />
              <button className={styles.judgeSubmit} type="submit" disabled={pending !== null}>
                {pending === "judge" ? "Checking…" : "Use judge access"}
              </button>
            </form>
          </section>

          <p className={styles.guest}>
            Just looking?{" "}
            <button
              type="button"
              className={styles.guestLink}
              onClick={() => void continueAsGuest()}
              disabled={pending !== null}
            >
              {pending === "guest" ? "Opening your run" : "Continue as a guest"}
            </button>
            . One mission, no account.
          </p>

          <p className={styles.legal}>
            By continuing you agree to the <Link href="/terms">terms</Link> and the{" "}
            <Link href="/privacy">privacy policy</Link>. No tokens stored, no data sold.
          </p>
        </div>
      </section>

      <aside className={styles.panel} aria-hidden="true">
        <Image
          src="/images/cardea/signin-panel.webp"
          alt=""
          fill
          sizes="(max-width: 900px) 0px, 52vw"
          className={styles.panelArt}
          priority
        />
      </aside>
    </main>
  );
}
