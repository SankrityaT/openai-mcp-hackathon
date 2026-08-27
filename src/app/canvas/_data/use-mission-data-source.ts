"use client";

import { useEffect, useState } from "react";
import type { DataModeState, SessionProbe } from "@/core/contracts/data-mode";
import { parseDataModeSetting, resolveDataMode } from "@/core/contracts/data-mode";
import type {
  MissionDataSource,
  MissionSpineNode,
  MissionSpineSummary,
} from "@/core/contracts/mission-data-source";
import { CardeaMissionHttpClient } from "@/core/contracts/mission-http-client";
import { createFixtureMissionDataSource } from "./fixture-mission-data-source";
import { createLiveMissionDataSource } from "./live-mission-data-source";

export type MissionDataSourceContext = {
  getFixtureNodes(): MissionSpineNode[];
  hasPendingFixtureApproval(): boolean;
};

export type MissionDataSourceHandle = {
  dataSource: MissionDataSource;
  dataMode: DataModeState;
  session: SessionProbe;
  spine: MissionSpineSummary;
  refreshSession: () => void;
};

/** Live spine before any mission has been created in this session. */
const EMPTY_LIVE_SPINE: MissionSpineSummary = {
  dataMode: "live",
  persisted: true,
  missionId: null,
  missionStatus: null,
  mandateVersion: null,
  stateVersion: null,
  latestSequence: null,
  nodes: [],
  pendingApprovalIds: [],
};

/**
 * Chooses between the fixture and live mission data sources.
 *
 * Live mode requires both `NEXT_PUBLIC_CARDEA_DATA_MODE=live` and an
 * authenticated Cardea session. Anything else degrades to fixtures and carries
 * a truthful notice; the interface never claims persistence it does not have.
 */
export function useMissionDataSource(
  context: MissionDataSourceContext,
): MissionDataSourceHandle {
  const configuredValue = process.env.NEXT_PUBLIC_CARDEA_DATA_MODE;
  const wantsLive = parseDataModeSetting(configuredValue).requestedMode === "live";

  const [session, setSession] = useState<SessionProbe>(
    wantsLive ? { status: "pending" } : { status: "anonymous" },
  );
  const [sessionNonce, setSessionNonce] = useState(0);
  const [liveSpine, setLiveSpine] = useState<MissionSpineSummary>(EMPTY_LIVE_SPINE);

  // One stable transport and one stable live source per mounted canvas: the
  // live source owns the committed snapshot between actions.
  const [runtime] = useState(() => {
    const client = new CardeaMissionHttpClient();
    const live = createLiveMissionDataSource({
      client,
      onSnapshot: () => setLiveSpine(live.summarize()),
      onSessionLost: () => setSession({ status: "anonymous" }),
      onServerUnavailable: () => setSession({ status: "unavailable" }),
    });
    return { client, live };
  });

  useEffect(() => {
    if (!wantsLive) return;
    const controller = new AbortController();
    runtime.client
      .getSession(controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return;
        if (!state.configured) {
          setSession({ status: "unavailable" });
          return;
        }
        setSession(
          state.authenticated && state.userId
            ? { status: "authenticated", userId: state.userId }
            : { status: "anonymous" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [runtime, wantsLive, sessionNonce]);

  const fixtureSource = createFixtureMissionDataSource({
    getNodes: () => context.getFixtureNodes(),
    hasPendingApproval: () => context.hasPendingFixtureApproval(),
  });

  const dataMode = resolveDataMode({ configuredValue, session });
  const live = dataMode.mode === "live";

  return {
    dataSource: live ? runtime.live : fixtureSource,
    dataMode,
    session,
    spine: live ? liveSpine : fixtureSource.summarize(),
    refreshSession: () => setSessionNonce((value) => value + 1),
  };
}
