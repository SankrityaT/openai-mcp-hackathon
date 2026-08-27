"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./account-modal.module.css";

const CONFIRM_PHRASE = "delete my account";

/**
 * The account sheet over the canvas: who holds the session, the way out, and
 * the one irreversible action Cardea offers. Deletion is a two-step surface
 * with an exact typed confirmation, mirroring the API's own contract; the
 * request itself is `DELETE /api/account`, which erases the account and every
 * mission, evidence record, and schedule under it.
 */
export function AccountModal({
  open,
  holderName,
  authenticated,
  onClose,
}: {
  open: boolean;
  holderName: string | null;
  authenticated: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<"account" | "farewell">("account");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset to the plain account view whenever the sheet reopens, deferred a
  // tick so state never changes inside the effect body itself.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setView("account");
      setPhrase("");
      setNotice(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* the redirect below lands on a signed-out surface either way */
    }
    window.location.assign("/");
  };

  const deleteAccount = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      });
      if (response.status === 204) {
        // The account is gone; the wallet state in this browser goes with it.
        try {
          window.localStorage.removeItem("cardea:wallet:v1");
        } catch {
          /* private mode */
        }
        window.location.assign("/");
        return;
      }
      setNotice(
        response.status === 401
          ? "Only a signed-in account can be deleted. Guest and judge sessions store nothing under a name."
          : "The account could not be deleted just now. Nothing was removed. Try again in a moment.",
      );
    } catch {
      setNotice("The account could not be deleted just now. Nothing was removed. Try again in a moment.");
    }
    setBusy(false);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="account-title">
      <button type="button" className={styles.backdrop} aria-label="Close account" onClick={onClose} />
      <div className={styles.panel}>
        {view === "account" ? (
          <>
            <div className={styles.head}>
              <div>
                <h2 className={styles.title} id="account-title">Your account</h2>
                <p className={styles.lede}>
                  {authenticated
                    ? `Signed in as ${holderName ?? "you"}.`
                    : "This is a guest session. Nothing here is stored under a name."}
                </p>
              </div>
              <button type="button" className={styles.close} aria-label="Close account" onClick={onClose}>
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg>
              </button>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => void signOut()}>
                Sign out
              </button>
              {authenticated && (
                <button type="button" className={styles.dangerLink} onClick={() => setView("farewell")}>
                  Delete my account
                </button>
              )}
            </div>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
          </>
        ) : (
          <div className={styles.farewell}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.mark} src="/images/cardea/logo-mark.png" alt="" width={72} height={72} />
            <h2 className={styles.title} id="account-title">Are you sure? We are sad to see you go.</h2>
            <p className={styles.farewellText}>
              Deleting your account erases it completely and immediately: every mission, every piece
              of evidence, every schedule, and the account itself. There is no undo and nothing is
              kept back. Cardea will hold the door open if you ever want to return.
            </p>
            <label className={styles.confirmLabel} htmlFor="account-confirm">
              Type <strong>{CONFIRM_PHRASE}</strong> to continue
            </label>
            <input
              id="account-confirm"
              className={styles.confirmInput}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={CONFIRM_PHRASE}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => setView("account")}>
                Keep my account
              </button>
              <button
                type="button"
                className={styles.danger}
                disabled={busy || phrase.trim().toLowerCase() !== CONFIRM_PHRASE}
                onClick={() => void deleteAccount()}
              >
                {busy ? "Closing the door" : "Delete everything"}
              </button>
            </div>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
