"use client";

/**
 * Live-only mission data layer for `/app`.
 *
 * Lifted from `src/app/canvas/_data/use-mission-data-source.ts` minus the
 * fixture branch. `/app` never shows representative state: when live mode is
 * unavailable this reports a typed unavailable state and says so, rather than
 * rendering a fixture mission that looks persisted and is not.
 *
 * Everything else is deliberately the same seam the canvas already proved:
 * one session probe, one guest mint, one restored mission id, and exactly one
 * stable `LiveMissionDataSource` per mount that owns the committed snapshot.
 */

import { useEffect, useState } from "react";
import type { DataModeReason, SessionProbe } from "@/core/contracts/data-mode";
import { parseDataModeSetting, resolveDataMode } from "@/core/contracts/data-mode";
import type { MissionSpineSummary } from "@/core/contracts/mission-data-source";
import { CardeaMissionHttpClient } from "@/core/contracts/mission-http-client";
import type { MissionStage } from "@/core/contracts/mission-stage";
import { deriveMissionStage } from "@/core/contracts/mission-stage";
import type { MissionEvent, MissionSnapshot } from "@/core/contracts/types";
import { ACTIVITY_LOG_LIMIT } from "@/app/canvas/_data/apply-mission-event";
import type { LiveMissionDataSource } from "@/app/canvas/_data/live-mission-data-source";
import { createLiveMissionDataSource } from "@/app/canvas/_data/live-mission-data-source";

/** Where a restored mission id is remembered across a reload, per tab. */
const LAST_MISSION_STORAGE_KEY = "cardea:lastMissionId";
const MISSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/**
 * Live mode's own resolution. Unlike `DataModeState` there is no fixture
 * fallback to describe, so every branch here is either working live state or
 * a truthful reason it is not available.
 */
export type LiveMissionDataMode =
  | { status: "live"; reason: DataModeReason; notice: string | null; persistenceAvailable: true }
  | { status: "pending"; reason: DataModeReason; notice: string; persistenceAvailable: false }
  | { status: "unavailable"; reason: DataModeReason; notice: string; persistenceAvailable: false };

export type LiveMissionHandle = {
  dataMode: LiveMissionDataMode;
  session: SessionProbe;
  spine: MissionSpineSummary;
  snapshot: MissionSnapshot | null;
  stage: MissionStage;
  /** Bounded ring buffer of the most recent applied events, oldest first. */
  events: readonly MissionEvent[];
  dataSource: LiveMissionDataSource;
  refreshSession: () => void;
};

/** Live spine before any mission has been created in this session. Nothing
   has been committed yet, so it must not claim persistence: inspect_canvas
   reports this object verbatim to a calling agent. */
const EMPTY_LIVE_SPINE: MissionSpineSummary = {
  dataMode: "live",
  persisted: false,
  missionId: null,
  missionStatus: null,
  mandateVersion: null,
  mandateApproved: null,
  stateVersion: null,
  latestSequence: null,
  nodes: [],
  pendingApprovalIds: [],
};

/**
 * Restates the shared data-mode resolution without its fixture vocabulary.
 * The reasons are reused verbatim so both surfaces still agree on *why*.
 */
function resolveLiveDataMode(
  configuredValue: string | undefined,
  session: SessionProbe,
): LiveMissionDataMode {
  const resolved = resolveDataMode({ configuredValue, session });
  if (resolved.mode === "live") {
    return {
      status: "live",
      reason: resolved.reason,
      notice: resolved.notice,
      persistenceAvailable: true,
    };
  }
  if (resolved.reason === "live_session_pending") {
    return {
      status: "pending",
      reason: resolved.reason,
      notice: "Checking your Cardea session.",
      persistenceAvailable: false,
    };
  }
  const notice =
    resolved.reason === "live_requires_sign_in"
      ? "Live mode needs a signed-in Cardea session."
      : resolved.reason === "live_unavailable"
        ? "Live mode is configured but the Cardea server did not answer."
        : "This deployment is not configured for live missions.";
  return { status: "unavailable", reason: resolved.reason, notice, persistenceAvailable: false };
}

/**
 * Subscribes `/app` to live mission state.
 *
 * The returned `dataSource` is stable for the life of the mount and is the
 * only writer of mission state; it is torn down on unmount so the realtime
 * channel (and its polling fallback) is released.
 */
export function useLiveMission(): LiveMissionHandle {
  const configuredValue = process.env.NEXT_PUBLIC_CARDEA_DATA_MODE;
  const wantsLive = parseDataModeSetting(configuredValue).requestedMode === "live";

  const [session, setSession] = useState<SessionProbe>(
    wantsLive ? { status: "pending" } : { status: "anonymous" },
  );
  const [sessionNonce, setSessionNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);
  const [spine, setSpine] = useState<MissionSpineSummary>(EMPTY_LIVE_SPINE);
  const [events, setEvents] = useState<readonly MissionEvent[]>([]);

  // One stable transport and one stable live source per mount: the live source
  // owns the committed snapshot between actions.
  const [runtime] = useState(() => {
    const client = new CardeaMissionHttpClient();
    const live = createLiveMissionDataSource({
      client,
      onSnapshot: (next) => {
        setSnapshot(next);
        setSpine(live.summarize());
        if (typeof window === "undefined") return;
        // Only ever write the key here. A null snapshot also arrives from
        // dispose() during StrictMode's double-mount, and clearing then would
        // erase the id the second mount needs for restore. A genuinely dead
        // id is cleared by the failed-adopt path below instead.
        if (next) window.sessionStorage.setItem(LAST_MISSION_STORAGE_KEY, next.mission.id);
      },
      onEvent: (event) => {
        setEvents((current) => {
          const next = [...current, event];
          return next.length > ACTIVITY_LOG_LIMIT
            ? next.slice(next.length - ACTIVITY_LOG_LIMIT)
            : next;
        });
      },
      onSessionLost: () => setSession({ status: "anonymous" }),
      onServerUnavailable: () => setSession({ status: "unavailable" }),
    });
    return { client, live };
  });

  useEffect(() => {
    if (!wantsLive) return;
    const controller = new AbortController();
    const restoreMission = async () => {
      const missionId = window.sessionStorage.getItem(LAST_MISSION_STORAGE_KEY);
      if (!missionId || !MISSION_ID_PATTERN.test(missionId)) return;
      try {
        await runtime.live.adopt(missionId, controller.signal);
        // Seed the activity buffer with the mission's committed history: an
        // adopted mission (a reload, a returning judge) would otherwise show
        // a full board next to an empty rail, because the buffer only ever
        // collects newly delivered events. These are the same real events,
        // bounded to the buffer's own limit.
        const history = await runtime.client.listEvents(missionId, 0, controller.signal);
        if (!controller.signal.aborted && history.length > 0) {
          setEvents((current) => {
            if (current.length > 0) return current;
            return history.length > ACTIVITY_LOG_LIMIT
              ? history.slice(history.length - ACTIVITY_LOG_LIMIT)
              : history;
          });
        }
      } catch {
        // An aborted adopt is this effect being cleaned up (StrictMode's
        // rehearsal mount, or navigation), not evidence the mission is gone.
        if (!controller.signal.aborted) {
          window.sessionStorage.removeItem(LAST_MISSION_STORAGE_KEY);
        }
      }
    };
    runtime.client
      .getSession(controller.signal)
      .then(async (state) => {
        if (controller.signal.aborted) return;
        if (!state.configured) {
          setSession({ status: "unavailable" });
          return;
        }
        if (state.authenticated && state.userId) {
          setSession({ status: "authenticated", userId: state.userId });
          await restoreMission();
          return;
        }
        if (state.judge) {
          setSession({ status: "judge" });
          await restoreMission();
          return;
        }
        if (state.guest) {
          setSession({ status: "guest" });
          await restoreMission();
          return;
        }
        const guestState = await runtime.client.issueGuestSession(controller.signal);
        if (controller.signal.aborted) return;
        setSession(guestState.judge ? { status: "judge" } : { status: "guest" });
        await restoreMission();
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [runtime, wantsLive, sessionNonce]);

  // Releases the realtime channel and its polling fallback with the mount.
  useEffect(() => {
    const { live } = runtime;
    return () => live.dispose();
  }, [runtime]);

  return {
    dataMode: resolveLiveDataMode(configuredValue, session),
    session,
    spine,
    snapshot,
    stage: deriveMissionStage(snapshot),
    events,
    dataSource: runtime.live,
    refreshSession: () => setSessionNonce((value) => value + 1),
  };
}
