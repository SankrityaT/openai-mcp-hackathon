"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCompanionToolAdapter,
  normalizeCompanionOrigin,
  toCompanionEvidenceEvent,
  type CompanionDiscovery,
  type CompanionEvidenceRecorder,
  type CompanionExecution,
  type CompanionInput,
  type CompanionToolSummary,
} from "./companion-tools";

export type CompanionPersistence = {
  persisted: boolean;
  reason?: string;
  eventId?: string;
  sequence?: number;
};

export type CompanionRecord = {
  id: string;
  toolName: string;
  input: CompanionInput | null;
  startedAt: string;
  outcome: CompanionExecution;
  persistence: CompanionPersistence;
};

export type CompanionToolsState = {
  /** The exact allowlisted companion origin, or null when none is configured. */
  origin: string | null;
  discovery: CompanionDiscovery;
  tools: CompanionToolSummary[];
  records: CompanionRecord[];
  busy: string | null;
  discover(): void;
  run(toolName: string, input: CompanionInput): void;
};

const NOT_CONFIGURED: CompanionDiscovery = {
  status: "not-configured",
  reason: "No companion origin is configured. Set NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN to an exact HTTPS origin.",
};

const MAX_RECORDS = 24;

let sequenceCounter = 0;
function nextId() {
  sequenceCounter += 1;
  return `companion-${sequenceCounter}`;
}

/**
 * Drive outbound companion WebMCP from the canvas.
 *
 * Discovery is never attempted before mount, so server rendering stays inert. Everything the
 * hook returns is either a real API result or an explicit unavailable state — nothing is
 * synthesized when the browser lacks WebMCP or the companion exposes nothing.
 */
export function useCompanionTools(options: {
  origin: string | null | undefined;
  /** Provided by the live data source. Absent means fixture mode: shown, never persisted. */
  recordEvidence?: CompanionEvidenceRecorder | null;
  fixtureReason?: string;
  /** Called once per completed invocation so the canvas can surface it without an effect. */
  onRecord?: (record: CompanionRecord) => void;
}): CompanionToolsState {
  const origin = useMemo(() => normalizeCompanionOrigin(options.origin), [options.origin]);
  const [discovery, setDiscovery] = useState<CompanionDiscovery>(
    origin ? { status: "empty", reason: "Discovery has not run yet." } : NOT_CONFIGURED,
  );
  const [records, setRecords] = useState<CompanionRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const recordEvidence = options.recordEvidence ?? null;
  const recorderRef = useRef(recordEvidence);
  useEffect(() => {
    recorderRef.current = recordEvidence;
  }, [recordEvidence]);

  const fixtureReason =
    options.fixtureReason ??
    "Fixture data mode: the companion result is shown here but no mission event was persisted.";
  const fixtureReasonRef = useRef(fixtureReason);
  useEffect(() => {
    fixtureReasonRef.current = fixtureReason;
  }, [fixtureReason]);

  const onRecord = options.onRecord;
  const onRecordRef = useRef(onRecord);
  useEffect(() => {
    onRecordRef.current = onRecord;
  }, [onRecord]);

  // `document.modelContext` only exists in the browser. During server rendering the adapter is
  // built with a null context, which makes it report "unsupported" and call nothing; the client
  // render then rebuilds it against the real API.
  const adapter = useMemo(
    () =>
      createCompanionToolAdapter({
        origin,
        modelContext: typeof document === "undefined" ? null : (document.modelContext ?? null),
      }),
    [origin],
  );

  const discoveryToken = useRef(0);
  const discover = useCallback(() => {
    discoveryToken.current += 1;
    const token = discoveryToken.current;
    void adapter.discover().then((result) => {
      // Ignore a slow response that a newer discovery has already superseded.
      if (discoveryToken.current === token) setDiscovery(result);
    });
  }, [adapter]);

  const run = useCallback(
    (toolName: string, input: CompanionInput) => {
      setBusy(toolName);
      const id = nextId();
      const startedAt = new Date().toISOString();
      void adapter
        .execute(toolName, input)
        .then(async (outcome): Promise<CompanionRecord> => {
          if (outcome.status !== "ok") {
            return {
              id,
              toolName,
              input,
              startedAt,
              outcome,
              persistence: { persisted: false, reason: "No result to record." },
            };
          }
          const recorder = recorderRef.current;
          if (!recorder) {
            return {
              id,
              toolName,
              input: outcome.evidence.input,
              startedAt,
              outcome,
              persistence: { persisted: false, reason: fixtureReasonRef.current },
            };
          }
          try {
            const receipt = await recorder(toCompanionEvidenceEvent(outcome.evidence));
            return {
              id,
              toolName,
              input: outcome.evidence.input,
              startedAt,
              outcome,
              persistence: {
                persisted: receipt.persisted,
                reason: receipt.reason,
                eventId: receipt.eventId,
                sequence: receipt.sequence,
              },
            };
          } catch (error) {
            return {
              id,
              toolName,
              input: outcome.evidence.input,
              startedAt,
              outcome,
              persistence: {
                persisted: false,
                reason: `Mission event append failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            };
          }
        })
        .then((record) => {
          setRecords((current) => [...current, record].slice(-MAX_RECORDS));
          setBusy((current) => (current === toolName ? null : current));
          onRecordRef.current?.(record);
        });
    },
    [adapter],
  );

  return {
    origin,
    discovery,
    tools: discovery.status === "ready" ? discovery.tools : [],
    records,
    busy,
    discover,
    run,
  };
}
