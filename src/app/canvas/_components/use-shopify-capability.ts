"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionEvidenceEvent, CompanionEvidenceRecorder } from "@/webmcp/companion-tools";
import {
  buildShopifyDurableEvidencePayload,
  isShopifyReadOnlyCapability,
  type ShopifyEvidenceRefs,
} from "@/harness/adapters/shopify-evidence-payload";

/**
 * Drives the optional Shopify storefront section of the canvas.
 *
 * Shopify is a *server-side* capability, not a WebMCP origin: the storefront's
 * own browser tools cannot be reached cross-origin (see the BE-10 status
 * section for the evidence), so this hook talks to Cardea's own authenticated
 * route and the adapter behind it. It deliberately mirrors `useCompanionTools`
 * in shape so the two external-capability surfaces read the same way.
 *
 * Everything it returns is either a real API result or an explicit unavailable
 * state. Nothing is synthesized when the store is unconfigured or unreachable.
 */

const ENDPOINT = "/api/integrations/shopify/execute";
const MAX_RECORDS = 12;

export type ShopifyStatus =
  | { configured: true; storeDomain: string; surface: "legacy" | "ucp"; deprecation: string | null }
  | { configured: false; reason: string };

export type ShopifyDiscovery =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; status: ShopifyStatus }
  | { state: "error"; reason: string };

/**
 * The transient, in-memory view of a storefront result.
 *
 * `excerpt` is present here and rendered in the canvas for the person looking
 * at it now. It is deliberately absent from the durable payload — displaying
 * catalog text is not caching it. See `shopify-evidence-payload.ts`.
 */
export type ShopifyEvidenceView = {
  storeDomain: string;
  tool: string;
  excerpt: string;
  digestSha256: string;
  bytes: number;
  truncated: boolean;
  capturedAt: string;
  refs: ShopifyEvidenceRefs;
};

export type ShopifyPersistence = {
  persisted: boolean;
  reason?: string;
  sequence?: number;
};

export type ShopifyRecord = {
  id: string;
  capabilityId: string;
  input: Record<string, unknown>;
  outcome:
    | { status: "ok"; evidence: ShopifyEvidenceView; provenance: string }
    | { status: "error"; reason: string };
  persistence: ShopifyPersistence;
};

let sequenceCounter = 0;
function nextId() {
  sequenceCounter += 1;
  return `shopify-${sequenceCounter}`;
}

function describeFailure(error: unknown): string {
  return error instanceof Error
    ? `Cardea rejected the evidence append: ${error.message}`
    : "Cardea could not be reached, so the storefront result was not recorded.";
}

export type ShopifyCapabilityState = {
  discovery: ShopifyDiscovery;
  records: ShopifyRecord[];
  busy: string | null;
  refresh(): void;
  run(capabilityId: string, input: Record<string, unknown>): void;
};

export function useShopifyCapability(options: {
  missionId: string | null;
  /** Provided by the live data source. Absent means fixture mode: shown, never persisted. */
  recordEvidence?: CompanionEvidenceRecorder | null;
  fixtureReason?: string;
  onRecord?: (record: ShopifyRecord) => void;
}): ShopifyCapabilityState {
  const [discovery, setDiscovery] = useState<ShopifyDiscovery>({ state: "idle" });
  const [records, setRecords] = useState<ShopifyRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const recorderRef = useRef(options.recordEvidence ?? null);
  useEffect(() => {
    recorderRef.current = options.recordEvidence ?? null;
  }, [options.recordEvidence]);

  const missionIdRef = useRef(options.missionId);
  useEffect(() => {
    missionIdRef.current = options.missionId;
  }, [options.missionId]);

  const fixtureReason =
    options.fixtureReason ??
    "Fixture data mode: the storefront result is shown here but no mission event was persisted.";
  const fixtureReasonRef = useRef(fixtureReason);
  useEffect(() => {
    fixtureReasonRef.current = fixtureReason;
  }, [fixtureReason]);

  const onRecordRef = useRef(options.onRecord);
  useEffect(() => {
    onRecordRef.current = options.onRecord;
  }, [options.onRecord]);

  const refresh = useCallback(() => {
    setDiscovery({ state: "loading" });
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, { method: "GET", credentials: "same-origin" });
        if (response.status === 401) {
          setDiscovery({
            state: "error",
            reason: "Sign in to Cardea to read a configured storefront.",
          });
          return;
        }
        if (!response.ok) {
          setDiscovery({ state: "error", reason: `Cardea returned ${response.status}.` });
          return;
        }
        const body = (await response.json()) as { status: ShopifyStatus };
        setDiscovery({ state: "ready", status: body.status });
      } catch {
        setDiscovery({ state: "error", reason: "Cardea could not be reached." });
      }
    })();
  }, []);

  const run = useCallback((capabilityId: string, input: Record<string, unknown>) => {
    setBusy(capabilityId);
    void (async () => {
      const id = nextId();
      let record: ShopifyRecord;

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capabilityId, input, missionId: missionIdRef.current ?? undefined }),
        });
        const body = (await response.json()) as {
          error?: string;
          reason?: string;
          result?: { output: ShopifyEvidenceView; provenance: string };
        };

        if (!response.ok || !body.result) {
          record = {
            id,
            capabilityId,
            input,
            outcome: {
              status: "error",
              reason: body.reason ?? body.error ?? `Cardea returned ${response.status}.`,
            },
            persistence: { persisted: false, reason: "No result to record." },
          };
        } else {
          const evidence = body.result.output;
          const recorder = recorderRef.current;
          if (!recorder) {
            // Fixture mode has no recorder at all, which is exactly what makes
            // the panel able to say truthfully that nothing was persisted.
            record = {
              id,
              capabilityId,
              input,
              outcome: { status: "ok", evidence, provenance: body.result.provenance },
              persistence: { persisted: false, reason: fixtureReasonRef.current },
            };
          } else {
            // Same catalogued event, same route, same optimistic-concurrency
            // retry as companion evidence. Only `source` differs, so the mission
            // log says plainly where the content came from.
            //
            // The excerpt is deliberately NOT in this payload. Shopify forbids
            // caching catalog results, so the text is rendered transiently above
            // and only the digest, byte counts, and opaque `refs` are durable.
            // See `shopify-evidence-payload.ts`.
            //
            // The cast is deliberate and narrow: `appendCompanionEvidence` pins
            // `source` to the companion literal, and claiming a storefront read
            // came from the companion would be untrue. It reads only
            // `toolName`, `capturedAt`, and `digest` off the payload, all of
            // which are present below.
            const event = {
              type: "evidence.recorded",
              trust: "untrusted",
              payload: buildShopifyDurableEvidencePayload({
                origin: body.result.provenance,
                capabilityId,
                tool: evidence.tool,
                readOnly: isShopifyReadOnlyCapability(capabilityId),
                input,
                digestSha256: evidence.digestSha256,
                resultBytes: evidence.bytes,
                excerpt: evidence.excerpt,
                truncated: evidence.truncated,
                refs: evidence.refs,
                capturedAt: evidence.capturedAt,
              }),
            } as unknown as CompanionEvidenceEvent;

            // `recorder` is the very same `useCompanionEvidenceRecorder`
            // instance the companion panel uses: same typed client, same
            // `/api/missions/:id/events` route, same ownership, schema, policy,
            // and quota gates, same sequence-conflict retry.
            const receipt = await recorder(event);
            record = {
              id,
              capabilityId,
              input,
              outcome: { status: "ok", evidence, provenance: body.result.provenance },
              persistence: {
                persisted: receipt.persisted,
                reason: receipt.reason,
                sequence: receipt.sequence,
              },
            };
          }
        }
      } catch (error) {
        record = {
          id,
          capabilityId,
          input,
          outcome: { status: "error", reason: describeFailure(error) },
          persistence: { persisted: false, reason: "No result to record." },
        };
      }

      setRecords((current) => [...current, record].slice(-MAX_RECORDS));
      setBusy((current) => (current === capabilityId ? null : current));
      onRecordRef.current?.(record);
    })();
  }, []);

  return { discovery, records, busy, refresh, run };
}
