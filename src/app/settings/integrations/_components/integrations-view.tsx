"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ComposioConnectionToolkit,
  PublicComposioConnection,
} from "@/harness/adapters/composio-connection-contract";
import styles from "./integrations-view.module.css";

const SIGN_IN_PATH = "/signin?next=%2Fsettings%2Fintegrations";

const STATUS_TEXT: Record<PublicComposioConnection["status"], string> = {
  connected: "Connected",
  pending: "Waiting for Google",
  disconnected: "Not connected",
  error: "Needs reconnecting",
};

type Notice = { tone: "info" | "error"; text: string } | null;

/**
 * Connected services.
 *
 * Deliberately a short list, not a dashboard: two rows, one action each, and
 * a status word. Cardea never displays or receives a token, so there is
 * nothing here to reveal, copy, or rotate. Everything consequential happens
 * on the server against the caller's own entity.
 */
export function IntegrationsView({
  configured,
  connections,
  notice: initialNotice,
}: {
  configured: boolean;
  connections: PublicComposioConnection[];
  notice: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ComposioConnectionToolkit | null>(null);
  const [notice, setNotice] = useState<Notice>(
    initialNotice ? { tone: "info", text: initialNotice } : null,
  );

  async function send(path: string, init: RequestInit) {
    const response = await fetch(path, { credentials: "same-origin", ...init });
    if (response.status === 401) {
      // The session went away mid-flow. Send them back to the one auth
      // surface rather than leaving a button that quietly does nothing.
      router.push(SIGN_IN_PATH);
      return null;
    }
    return response;
  }

  async function connect(toolkit: ComposioConnectionToolkit) {
    setPending(toolkit);
    setNotice(null);
    try {
      const response = await send("/api/integrations/composio/connections/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      if (!response) return;
      const result = (await response.json()) as {
        available?: boolean;
        outcome?: string;
        redirectUrl?: string;
      };
      if (result.available && result.outcome === "redirect" && result.redirectUrl) {
        // Google's own consent screen, opened by Composio. Keep the button
        // pending: the browser is already leaving.
        window.location.assign(result.redirectUrl);
        return;
      }
      setPending(null);
      if (result.available && result.outcome === "already_connected") {
        setNotice({ tone: "info", text: "That account is already connected." });
        router.refresh();
        return;
      }
      setNotice({
        tone: "error",
        text: "Cardea could not start that connection. Try again in a moment.",
      });
    } catch {
      setPending(null);
      setNotice({ tone: "error", text: "Cardea could not reach the connection service." });
    }
  }

  async function disconnect(toolkit: ComposioConnectionToolkit, connectionId: string) {
    setPending(toolkit);
    setNotice(null);
    try {
      const response = await send(
        `/api/integrations/composio/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE" },
      );
      if (!response) return;
      setPending(null);
      if (!response.ok) {
        setNotice({ tone: "error", text: "That connection could not be removed." });
        return;
      }
      setNotice({ tone: "info", text: "Disconnected. Cardea can no longer use that account." });
      router.refresh();
    } catch {
      setPending(null);
      setNotice({ tone: "error", text: "Cardea could not reach the connection service." });
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.head}>
          <Link className={styles.back} href="/app">
            Back to the board
          </Link>
          <h1>Connected services</h1>
          <p>
            Cardea reads these accounts only when a mission needs them. Google holds your
            password, and the connection tokens stay with the connector, never with Cardea.
          </p>
        </header>

        {!configured && (
          <p className={styles.notice} data-tone="info" role="status">
            Connections are not configured for this deployment yet.
          </p>
        )}

        <ul className={styles.list}>
          {connections.map((connection) => (
            <li className={styles.row} key={connection.toolkit}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>{connection.label}</span>
                <span className={styles.rowStatus} data-status={connection.status}>
                  <i aria-hidden="true" />
                  {STATUS_TEXT[connection.status]}
                </span>
              </div>
              {connection.status === "connected" && connection.connectionId ? (
                <button
                  className={styles.secondaryAction}
                  type="button"
                  disabled={!configured || pending !== null}
                  onClick={() => void disconnect(connection.toolkit, connection.connectionId!)}
                >
                  {pending === connection.toolkit ? "Working…" : "Disconnect"}
                </button>
              ) : (
                <button
                  className={styles.action}
                  type="button"
                  disabled={!configured || pending !== null}
                  onClick={() => void connect(connection.toolkit)}
                >
                  {pending === connection.toolkit ? "Opening Google…" : "Connect"}
                </button>
              )}
            </li>
          ))}
        </ul>

        {notice && (
          <p className={styles.notice} data-tone={notice.tone} role="status">
            {notice.text}
          </p>
        )}
      </div>
    </main>
  );
}
