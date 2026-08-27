"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./integrations-modal.module.css";

type Status = "connected" | "pending" | "disconnected";
type Connection = {
  toolkit: "gmail" | "googlecalendar";
  label: string;
  status: Status;
  connectionId: string | null;
};

/**
 * What each connection actually does with Cardea, stated honestly. Reads run
 * inside a mandate you approved. The two writes behind these connections
 * (create a calendar event, prepare a Gmail draft) stop at the approval hinge
 * every single time, so the copy says that rather than implying either more
 * or less than Cardea can do.
 */
const SERVICES: {
  toolkit: Connection["toolkit"];
  name: string;
  logo: string;
  access: string;
  oneLiner: string;
  bullets: string[];
}[] = [
  {
    toolkit: "gmail",
    name: "Gmail",
    logo: "/images/integrations/gmail.png",
    access: "Reads freely · drafts with approval",
    oneLiner: "Cardea reads the messages a mission needs and shows them as evidence.",
    bullets: [
      "Find quotes, confirmations, and threads that matter to a mission",
      "Bring the exact messages onto the canvas as evidence you can inspect",
      "Prepare a draft for your approval, and Cardea still never sends",
    ],
  },
  {
    toolkit: "googlecalendar",
    name: "Google Calendar",
    logo: "/images/integrations/calendar.png",
    access: "Reads freely · writes with approval",
    oneLiner: "Cardea reads your commitments so missions plan around your real life.",
    bullets: [
      "Read the events a mission must work around",
      "Find open windows for viewings, calls, and deliveries",
      "Add an event only after you approve it on the canvas",
    ],
  },
];

const COMING = [
  { name: "Google Maps", logo: "/images/integrations/maps.png" },
  { name: "Google Docs", logo: "/images/integrations/docs.png" },
  { name: "Google Sheets", logo: "/images/integrations/sheets.png" },
];

export function IntegrationsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [emailNotify, setEmailNotify] = useState<boolean | null>(null);
  const [notifyPending, setNotifyPending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/composio/connections", {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setUnavailable("Sign in to connect services.");
        return;
      }
      const data = await response.json();
      if (!data.available) {
        setUnavailable("Connections are not configured for this deployment yet.");
        return;
      }
      setUnavailable(null);
      setConnections(data.connections ?? []);
    } catch {
      setUnavailable(
        "Connection status could not be read just now. Connecting may still work.",
      );
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Deferred a tick: the lint contract forbids a synchronous call chain
    // from an effect into setState, and status arriving a frame later is
    // invisible next to the network round trip anyway.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const connect = useCallback(async (toolkit: string) => {
    setPending(toolkit);
    try {
      const response = await fetch("/api/integrations/composio/connections/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      const data = await response.json();
      if (data.redirectUrl) {
        window.location.assign(data.redirectUrl);
        return;
      }
      setPending(null);
      setUnavailable(
        data.reason === "auth_config_missing"
          ? "This service's auth configuration is missing in Composio."
          : "The connection could not be started. Try again in a moment.",
      );
    } catch {
      setPending(null);
      setUnavailable("The connection could not be started. Try again in a moment.");
    }
  }, []);

  const disconnect = useCallback(
    async (connectionId: string) => {
      setPending(connectionId);
      try {
        await fetch(`/api/integrations/composio/connections/${connectionId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
      } catch {
        /* refresh shows the truth either way */
      }
      setPending(null);
      void refresh();
    },
    [refresh],
  );

  // --- Notifications ---------------------------------------------------
  // Reach-me approvals. Kept below the connections state on purpose: this is
  // a separate promise (where Cardea may reach you) from a connection (what
  // Cardea may read), and conflating them in one control would misdescribe
  // both.
  const refreshNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/email", {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setEmailNotify(null);
        return;
      }
      const data = await response.json();
      setEmailNotify(data.enabled === true);
    } catch {
      setEmailNotify(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void refreshNotifications(), 0);
    return () => clearTimeout(timer);
  }, [open, refreshNotifications]);

  const setNotifications = useCallback(
    async (enabled: boolean) => {
      setNotifyPending(true);
      try {
        await fetch("/api/notifications/email", {
          method: enabled ? "POST" : "DELETE",
          credentials: "same-origin",
        });
      } catch {
        // The refresh below reports the truth either way.
      }
      setNotifyPending(false);
      await refreshNotifications();
    },
    [refreshNotifications],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="integrations-title">
      <button className={styles.backdrop} type="button" aria-label="Close" onClick={onClose} />
      <div className={styles.panel} ref={panelRef}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title} id="integrations-title">Connected services</h2>
            <p className={styles.lede}>
              Connections let a mission you approve read from your own accounts, and stop for
              your approval before it writes to one. OAuth tokens live with Composio, never with
              Cardea, and you can disconnect at any time.
            </p>
          </div>
          <button className={styles.close} type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        {unavailable && <p className={styles.notice} role="status">{unavailable}</p>}

        <div className={styles.grid}>
          {SERVICES.map((service) => {
            const connection = connections?.find((c) => c.toolkit === service.toolkit) ?? null;
            const connected = connection?.status === "connected";
            const isOpen = expanded === service.toolkit;
            return (
              <article key={service.toolkit} className={styles.card} data-open={isOpen || undefined}>
                <button
                  type="button"
                  className={styles.cardHead}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : service.toolkit)}
                >
                  <img src={service.logo} alt="" width={96} height={96} className={styles.logo} />
                  <span className={styles.cardName}>
                    {service.name}
                    <span className={styles.cardStates}>
                      <span className={styles.readOnly}>{service.access}</span>
                      <span className={styles.status} data-connected={connected || undefined}>
                        <i aria-hidden="true" />
                        {connected ? "Connected" : "Not connected"}
                      </span>
                    </span>
                  </span>
                  <svg className={styles.chev} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </button>

                {isOpen && (
                  <div className={styles.detail}>
                    <p className={styles.oneLiner}>{service.oneLiner}</p>
                    <p className={styles.withLabel}>With {service.name} and Cardea, you can:</p>
                    <ol className={styles.bullets}>
                      {service.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className={styles.cardFoot}>
                  {connected && connection?.connectionId ? (
                    <button
                      type="button"
                      className={styles.disconnect}
                      disabled={pending !== null}
                      onClick={() => void disconnect(connection.connectionId as string)}
                    >
                      {pending === connection.connectionId ? "Disconnecting" : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.connect}
                      data-busy={pending === service.toolkit || undefined}
                      disabled={pending !== null || !!unavailable}
                      onClick={() => void connect(service.toolkit)}
                    >
                      {pending === service.toolkit ? "Opening" : "Connect"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {COMING.map((service) => (
            <article key={service.name} className={styles.card} data-coming="">
              <div className={styles.cardHead}>
                <img src={service.logo} alt="" width={96} height={96} className={styles.logo} />
                <span className={styles.cardName}>
                  {service.name}
                  <span className={styles.cardStates}>
                    <span className={styles.coming}>Not yet available</span>
                  </span>
                </span>
              </div>
            </article>
          ))}
        </div>

        <section className={styles.notify} aria-labelledby="integrations-notify-title">
          <h3 className={styles.notifyTitle} id="integrations-notify-title">Notifications</h3>
          <div className={styles.notifyRow}>
            <span className={styles.notifyGlyph} aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
                <path d="m3 5.5 7 5.5 7-5.5" />
              </svg>
            </span>
            <span className={styles.notifyBody}>
              <span className={styles.notifyName}>Email me at the hinge</span>
              <span className={styles.notifyLine}>
                Cardea emails you only when a mission stops for your judgment. Never anything else.
              </span>
            </span>
            <span className={styles.status} data-connected={emailNotify === true || undefined}>
              <i aria-hidden="true" />
              {emailNotify === true ? "Enabled" : "Off"}
            </span>
            {emailNotify === true ? (
              <button
                type="button"
                className={styles.disconnect}
                disabled={notifyPending}
                onClick={() => void setNotifications(false)}
              >
                {notifyPending ? "Saving" : "Disable"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.connect}
                disabled={notifyPending}
                onClick={() => void setNotifications(true)}
              >
                {notifyPending ? "Saving" : "Enable"}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
