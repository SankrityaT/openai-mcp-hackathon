"use client";

import { useCallback, useEffect, useState } from "react";
import {
  StandingMissionsPanel,
  type StandingMissionDraft,
  type StandingMissionSummary,
} from "./standing-missions-panel";
import styles from "./standing-missions-modal.module.css";

/**
 * Container for the standing-missions panel: fetches the person's schedules,
 * relays create/toggle/delete, and reports honestly when the surface is not
 * available to the current session (guests and judges cannot hold schedules).
 */
export function StandingMissionsModal({
  open,
  defaultGoal,
  onClose,
}: {
  open: boolean;
  defaultGoal?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StandingMissionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/standing-missions", { credentials: "same-origin" });
      if (response.status === 401) {
        setNotice("Sign in to put a mission on a schedule. Guest and judge sessions cannot.");
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      setNotice(null);
      setRows(data.standingMissions ?? []);
    } catch {
      setNotice("Standing missions could not be read just now.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
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

  const create = useCallback(
    async (draft: StandingMissionDraft) => {
      setBusy(true);
      try {
        const response = await fetch("/api/standing-missions", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!response.ok) throw new Error("create_failed");
      } catch {
        setNotice("The schedule could not be created. Try again in a moment.");
      }
      setBusy(false);
      void refresh();
    },
    [refresh],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await fetch(`/api/standing-missions/${id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
      } catch {
        /* refresh shows the truth */
      }
      void refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/standing-missions/${id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
      } catch {
        /* refresh shows the truth */
      }
      void refresh();
    },
    [refresh],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="standing-title">
      <button className={styles.backdrop} type="button" aria-label="Close" onClick={onClose} />
      <div className={styles.panel}>
        <header className={styles.head}>
          <h2 className={styles.title} id="standing-title">Standing missions</h2>
          <button className={styles.close} type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        <StandingMissionsPanel
          standingMissions={rows}
          defaultGoal={defaultGoal}
          busy={busy}
          onCreate={(draft) => void create(draft)}
          onToggle={(id, enabled) => void toggle(id, enabled)}
          onDelete={(id) => void remove(id)}
        />
      </div>
    </div>
  );
}
