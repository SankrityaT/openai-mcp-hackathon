import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
} from "../../core/contracts/safe-capabilities";

// The walking-skeleton capability required by BE-02. It is entirely
// deterministic, read-only, and makes no network call — a stand-in that
// proves discovery -> policy -> idempotency -> execution -> event commit
// without depending on any external provider.
//
// Trust design: the capability descriptor itself is "derived" (Cardea owns
// and controls this deterministic function, so the policy engine's
// untrusted-capability hard rule does not unconditionally block it). The
// *evidence it returns* is still labeled "untrusted" on the execution result
// and on any evidence.recorded event built from it, because the content is a
// stand-in for external research and must never be treated as a verified
// fact by planning.

export { INTERNAL_FIXTURE_CAPABILITY_ID, INTERNAL_FIXTURE_ORIGIN };
const MAX_FINDING_CHARS = 400;
const MAX_OUTPUT_BYTES = 4_096;

function boundedTopic(input: unknown): string {
  const raw =
    typeof input === "object" && input !== null && "topic" in (input as Record<string, unknown>)
      ? String((input as Record<string, unknown>).topic ?? "")
      : String(input ?? "");
  return raw.length > MAX_FINDING_CHARS ? `${raw.slice(0, MAX_FINDING_CHARS)}…` : raw || "unspecified topic";
}

export class InternalFixtureAdapter implements CapabilityAdapter {
  readonly provider = "internal";

  async discover(): Promise<NormalizedCapability[]> {
    return [
      {
        id: INTERNAL_FIXTURE_CAPABILITY_ID,
        provider: "internal",
        name: "internal.echo_research",
        description:
          "Deterministic bounded fixture evidence generator for walking-skeleton verification. Returns no live external data and performs no network call.",
        inputSchema: {
          type: "object",
          properties: { topic: { type: "string", maxLength: 200 } },
          required: ["topic"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            finding: { type: "string" },
            topic: { type: "string" },
          },
        },
        risk: { level: "low", categories: ["read"] },
        trust: { level: "derived", origin: INTERNAL_FIXTURE_ORIGIN, provenance: "internal-fixture" },
        readOnly: true,
      },
    ];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    if (request.capabilityId !== INTERNAL_FIXTURE_CAPABILITY_ID) {
      throw new Error(`internal fixture adapter cannot execute ${request.capabilityId}`);
    }
    const topic = boundedTopic(request.input);
    const finding = `Fixture evidence for "${topic}": deterministic bounded placeholder result. No live network call was made.`;
    const bounded = finding.length > MAX_OUTPUT_BYTES ? `${finding.slice(0, MAX_OUTPUT_BYTES)}…` : finding;
    return {
      executionId: request.idempotencyKey,
      output: { finding: bounded, topic },
      summary: "Returned deterministic bounded fixture evidence.",
      provenance: "internal://cardea/fixtures/echo_research",
      trust: "untrusted",
    };
  }
}

export const internalFixtureAdapter = new InternalFixtureAdapter();
