import { generateText } from "ai";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";
import { routeModel } from "../model-router";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
} from "../../core/contracts/safe-capabilities";

// Cardea's internal worker capability. With a configured model key it does
// the node's actual written work: research framing, checklists, outlines,
// briefs. Without one (unit tests, offline dev) it degrades to the original
// deterministic bounded fixture so discovery -> policy -> idempotency ->
// execution -> event commit stays provable with no network.
//
// Trust design: the capability descriptor itself is "derived" (Cardea owns
// and controls this function, so the policy engine's untrusted-capability
// hard rule does not unconditionally block it). The *evidence it returns*
// is still labeled "untrusted" on the execution result and on any
// evidence.recorded event built from it: model-written content is a draft
// for the person to review, never a verified external fact.

export { INTERNAL_FIXTURE_CAPABILITY_ID, INTERNAL_FIXTURE_ORIGIN };
const MAX_TOPIC_CHARS = 8_000;
const MAX_DELIVERABLE_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 160;

function boundedTopic(input: unknown): string {
  const raw =
    typeof input === "object" && input !== null && "topic" in (input as Record<string, unknown>)
      ? String((input as Record<string, unknown>).topic ?? "")
      : String(input ?? "");
  return raw.length > MAX_TOPIC_CHARS ? `${raw.slice(0, MAX_TOPIC_CHARS)}…` : raw || "unspecified topic";
}

function summaryLine(deliverable: string): string {
  const firstLine = deliverable.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const flattened = firstLine.replace(/^#+\s*/, "").replace(/\s+/g, " ");
  if (!flattened) return "Produced a written deliverable for review.";
  return flattened.length > MAX_SUMMARY_CHARS ? `${flattened.slice(0, MAX_SUMMARY_CHARS - 1)}…` : flattened;
}

export type InternalWorkerGenerate = (topic: string) => Promise<string>;

async function modelDeliverable(topic: string): Promise<string> {
  const route = routeModel();
  const { openai } = await import("@ai-sdk/openai");
  const result = await generateText({
    model: openai(route.modelId),
    system:
      "You are Cardea's internal worker. Produce the written deliverable a mission step asks for: " +
      "a checklist, outline, comparison, brief, or plan. Be concrete and complete, but concise. " +
      "Plain text with simple line breaks and dashes; no markdown headings. Never claim to have " +
      "contacted anyone, spent money, or accessed an external account: this step is written work only. " +
      "State assumptions plainly when the step's inputs leave gaps. " +
      "When upstream evidence is provided, work strictly from it and name the sites it came from; " +
      "when it is absent for a claim, say so rather than filling in from memory. " +
      "For buying or booking recommendations, lead like a sharp friend texting: the FIRST line is the " +
      "verdict in under 30 words, naming the pick, the price, and one reason, for example: " +
      "Anne's Flowers is your best bet. $50 to $60 birthday arrangements and a solid local rep. " +
      "The SECOND line is 'Order here: <url>' using the exact page address from the evidence that best " +
      "leads to ordering the pick; never invent or shorten a url, and if no evidence url leads toward " +
      "ordering, say which site to search instead. Then a section titled 'The receipts' with AT MOST six " +
      "short bullets: the observed price range, the runner-up with its url, the budget option, the single " +
      "biggest caveat, one risk reducer, and the one thing to verify before paying. No other sections. " +
      "Every fact and url must come from the evidence provided.",
    prompt: topic,
    maxOutputTokens: 900,
  });
  const text = result.text.trim();
  if (!text) throw new Error("internal worker returned an empty deliverable");
  return text.length > MAX_DELIVERABLE_CHARS ? `${text.slice(0, MAX_DELIVERABLE_CHARS)}…` : text;
}

export class InternalFixtureAdapter implements CapabilityAdapter {
  readonly provider = "internal";

  constructor(private readonly generate?: InternalWorkerGenerate) {}

  async discover(): Promise<NormalizedCapability[]> {
    return [
      {
        id: INTERNAL_FIXTURE_CAPABILITY_ID,
        provider: "internal",
        name: "internal.echo_research",
        description:
          "Cardea's internal written-work capability: drafts the checklists, outlines, comparisons, and briefs a step calls for. Touches no external account; without a configured model it returns a clearly labeled deterministic fixture.",
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

    const generate =
      this.generate ?? (process.env.OPENAI_API_KEY ? modelDeliverable : null);

    if (generate) {
      // A model failure propagates: the harness retry and failure paths are
      // the honest response, never a placeholder passed off as work.
      // The echoed topic is truncated hard: with upstream evidence attached
      // it can approach the executor's whole output byte budget, and the
      // deliverable is the part that must never be squeezed out.
      const deliverable = await generate(topic);
      return {
        executionId: request.idempotencyKey,
        output: { finding: deliverable, topic: topic.slice(0, 200) },
        summary: summaryLine(deliverable),
        provenance: "internal://cardea/worker/model",
        trust: "untrusted",
      };
    }

    const finding = `Fixture evidence for "${topic}": deterministic bounded placeholder result. No live network call was made.`;
    return {
      executionId: request.idempotencyKey,
      output: { finding, topic },
      summary: "Returned deterministic bounded fixture evidence.",
      provenance: "internal://cardea/fixtures/echo_research",
      trust: "untrusted",
    };
  }
}

export const internalFixtureAdapter = new InternalFixtureAdapter();
