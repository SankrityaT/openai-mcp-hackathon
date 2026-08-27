"use client";

import { useEffect, useState } from "react";
import styles from "./canvas.module.css";

type Toolkit = "gmail" | "googlecalendar";
type ToolkitState = {
  slug: string;
  name: string;
  connected: boolean;
  logo?: string;
};

type SessionState =
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  | { state: "ready"; toolkits: ToolkitState[] };

const choices: Array<{ slug: Toolkit; name: string; description: string }> = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Search an authorized demo mailbox and read one selected message.",
  },
  {
    slug: "googlecalendar",
    name: "Google Calendar",
    description: "Read calendar windows and find available time without creating events.",
  },
];

export function IntegrationPanel({
  missionId,
  waitingNodeId,
  onClose,
}: {
  missionId: string | null;
  waitingNodeId: string | null;
  onClose: () => void;
}) {
  const [session, setSession] = useState<SessionState>({ state: "loading" });
  const [connecting, setConnecting] = useState<Toolkit | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/composio/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("session_unavailable");
        return response.json() as Promise<{
          available: boolean;
          reason?: string;
          toolkits?: ToolkitState[];
        }>;
      })
      .then((result) => {
        setSession(
          result.available
            ? { state: "ready", toolkits: result.toolkits ?? [] }
            : { state: "unavailable", reason: result.reason ?? "not_configured" },
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSession({
            state: "unavailable",
            reason: error instanceof Error ? error.message : "session_unavailable",
          });
        }
      });
    return () => controller.abort();
  }, []);

  async function connect(toolkit: Toolkit) {
    setConnecting(toolkit);
    try {
      const response = await fetch("/api/integrations/composio/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolkit,
          ...(missionId ? { missionId } : {}),
          ...(missionId && waitingNodeId ? { nodeId: waitingNodeId } : {}),
        }),
      });
      const result = (await response.json()) as {
        available?: boolean;
        redirectUrl?: string;
      };
      if (!response.ok || !result.available || !result.redirectUrl) {
        throw new Error("authorization_unavailable");
      }
      window.location.assign(result.redirectUrl);
    } catch {
      setSession({ state: "unavailable", reason: "authorization_unavailable" });
      setConnecting(null);
    }
  }

  return (
    <section
      className={styles.walletOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-title"
    >
      <button
        className={styles.walletBackdrop}
        type="button"
        aria-label="Close connections"
        onClick={onClose}
      />
      <div className={`${styles.walletPanel} ${styles.integrationPanel}`}>
        <header>
          <div>
            <span className={styles.eyebrow}>Connections</span>
            <h2 id="integration-title">Open only the doors this mission needs.</h2>
          </div>
          <button type="button" aria-label="Close connections" onClick={onClose}>×</button>
        </header>
        <p className={styles.integrationIntro}>
          Cardea requests read-only Gmail or Calendar access through Composio. A waiting node
          resumes only after the signed callback returns to this exact mission.
        </p>
        <div className={styles.integrationList}>
          {choices.map((choice) => {
            const status =
              session.state === "ready"
                ? session.toolkits.find((toolkit) => toolkit.slug === choice.slug)
                : undefined;
            return (
              <article key={choice.slug}>
                <span className={styles.integrationMark} aria-hidden="true">
                  {choice.slug === "gmail" ? "M" : "31"}
                </span>
                <div>
                  <h3>{choice.name}</h3>
                  <p>{choice.description}</p>
                </div>
                <button
                  type="button"
                  className={status?.connected ? styles.secondaryButton : styles.primaryButton}
                  disabled={
                    session.state !== "ready" || status?.connected || connecting !== null
                  }
                  onClick={() => void connect(choice.slug)}
                >
                  {status?.connected
                    ? "Connected"
                    : connecting === choice.slug
                      ? "Opening…"
                      : "Connect"}
                </button>
              </article>
            );
          })}
        </div>
        <footer>
          <span>
            {session.state === "loading"
              ? "Checking connection state…"
              : session.state === "unavailable"
                ? `Connections unavailable: ${session.reason.replaceAll("_", " ")}`
                : "Read-only tools · revoke from your provider at any time"}
          </span>
          {waitingNodeId && <b>Waiting node will resume after connection</b>}
        </footer>
      </div>
    </section>
  );
}

