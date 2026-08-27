"use client";

import { useCallback, useMemo } from "react";
import type { CardeaDataMode } from "@/core/contracts/data-mode";
import { CardeaMissionHttpClient, MissionHttpError } from "@/core/contracts/mission-http-client";
import {
  appendCompanionEvidence,
  type CompanionEvidenceEvent,
  type CompanionEvidenceRecorder,
  type CompanionEvidenceReceipt,
} from "./companion-tools";

/**
 * Durable provenance for outbound cross-origin WebMCP results.
 *
 * A companion result is third-party content, so it enters the mission log the only way such
 * content may: as an `evidence.recorded` event with `trust: "untrusted"`. That is the one
 * catalogued type whose stated purpose is evidence with provenance, and it does not materialize
 * mission or node state, so appending it can never move the mission.
 *
 * It travels the same `/api/missions/:id/events` route and the same typed client the live mission
 * data source uses, so the server applies identical ownership, schema, policy, and quota gates.
 * It reads the mission seam's public summary but never reaches into its internals.
 */

/** Maps a transport failure to a reason the canvas can show verbatim. */
function describeFailure(error: unknown): string {
  if (!(error instanceof MissionHttpError)) {
    return "Cardea could not be reached, so the companion result was not recorded.";
  }
  if (error.status === 401) {
    return "Your Cardea session has expired, so the companion result was not recorded.";
  }
  if (error.denial) {
    return "Recording this evidence is outside the current allowance. Nothing was recorded.";
  }
  if (error.status === 403) {
    return "Cardea policy refused to record this companion evidence.";
  }
  if (error.status === 409) {
    return "The mission log moved on while recording. Nothing was recorded; run the tool again.";
  }
  return `Cardea rejected the evidence append (${error.status}).`;
}

function isSequenceConflict(error: unknown): boolean {
  return error instanceof MissionHttpError && error.status === 409;
}

export function useCompanionEvidenceRecorder(options: {
  dataMode: CardeaDataMode;
  missionId: string | null;
  /** Injectable for tests; defaults to one same-origin client. */
  client?: CardeaMissionHttpClient;
}): CompanionEvidenceRecorder | null {
  const { dataMode, missionId } = options;
  const injected = options.client;

  // Stateless and same-origin, so an independent instance costs nothing and keeps this module
  // from depending on the mission seam's private runtime.
  const client = useMemo(
    () => injected ?? (typeof window === "undefined" ? null : new CardeaMissionHttpClient()),
    [injected],
  );

  const record = useCallback(
    async (event: CompanionEvidenceEvent): Promise<CompanionEvidenceReceipt> => {
      if (!client) {
        return { persisted: false, reason: "No Cardea client is available in this context." };
      }
      return appendCompanionEvidence({
        client,
        missionId,
        event,
        describeFailure,
        isSequenceConflict,
        newCorrelationId: () => globalThis.crypto.randomUUID(),
      });
    },
    [client, missionId],
  );

  // Fixture mode has no recorder at all, which is what makes the companion panel state plainly
  // that the result was shown but never persisted.
  return dataMode === "live" ? record : null;
}
