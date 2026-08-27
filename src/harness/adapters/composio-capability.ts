import {
  COMPOSIO_APPROVAL_GATED_CAPABILITIES,
  COMPOSIO_PROVIDER_ORIGIN,
  COMPOSIO_SAFE_READ_CAPABILITIES,
} from "../../core/contracts/safe-capabilities";
import {
  CapabilityConnectionRequiredError,
  CapabilityProviderError,
} from "../capability-errors";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";

type SafeComposioCapability = (typeof COMPOSIO_SAFE_READ_CAPABILITIES)[number];
type GatedComposioCapability = (typeof COMPOSIO_APPROVAL_GATED_CAPABILITIES)[number];
type ComposioCapabilityEntry = SafeComposioCapability | GatedComposioCapability;
type ComposioToolSlug = ComposioCapabilityEntry["tool"];

/**
 * Field names below are Cardea's own bounded shape, passed through to
 * Composio unchanged, exactly as the read schemas already are. They still
 * have to be reconciled with the live Composio catalogue's argument names
 * before the writes are exercised against a real account; this environment
 * has no reachable Composio credential and the installed SDK ships no tool
 * schemas to check them against.
 */
const inputSchemas: Record<ComposioToolSlug, NormalizedCapability["inputSchema"]> = {
  GOOGLECALENDAR_FIND_EVENT: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 500 },
      timeMin: { type: "string", maxLength: 80 },
      timeMax: { type: "string", maxLength: 80 },
    },
    additionalProperties: true,
  },
  GOOGLECALENDAR_FIND_FREE_SLOTS: {
    type: "object",
    properties: {
      timeMin: { type: "string", maxLength: 80 },
      timeMax: { type: "string", maxLength: 80 },
      timezone: { type: "string", maxLength: 80 },
      durationMinutes: { type: "integer", minimum: 5, maximum: 1440 },
    },
    additionalProperties: true,
  },
  GMAIL_FETCH_EMAILS: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 500 },
      maxResults: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: true,
  },
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: {
    type: "object",
    properties: {
      messageId: { type: "string", minLength: 1, maxLength: 300 },
    },
    required: ["messageId"],
    additionalProperties: true,
  },
  GOOGLECALENDAR_CREATE_EVENT: {
    type: "object",
    properties: {
      calendarId: { type: "string", maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      startIso: { type: "string", minLength: 1, maxLength: 80 },
      endIso: { type: "string", minLength: 1, maxLength: 80 },
      description: { type: "string", maxLength: 2_000 },
      attendees: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 3, maxLength: 200 },
      },
    },
    required: ["title", "startIso", "endIso"],
    additionalProperties: false,
  },
  GMAIL_CREATE_EMAIL_DRAFT: {
    type: "object",
    properties: {
      to: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string", minLength: 3, maxLength: 200 },
      },
      subject: { type: "string", minLength: 1, maxLength: 300 },
      body: { type: "string", minLength: 1, maxLength: 10_000 },
    },
    required: ["to", "subject", "body"],
    additionalProperties: false,
  },
};

const descriptions: Record<ComposioToolSlug, string> = {
  GOOGLECALENDAR_FIND_EVENT:
    "Find matching events in the user's connected Google Calendar. Read-only and connection-scoped.",
  GOOGLECALENDAR_FIND_FREE_SLOTS:
    "Find bounded free windows in the user's connected Google Calendar. Read-only and connection-scoped.",
  GMAIL_FETCH_EMAILS:
    "Search a user-authorized Gmail mailbox and return bounded message evidence. Read-only.",
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID:
    "Read one user-selected Gmail message by its exact message id. Read-only.",
  GOOGLECALENDAR_CREATE_EVENT:
    "Create one event in the user's connected Google Calendar. A write: it runs only after the user approves this exact action on the canvas, and never on its own.",
  GMAIL_CREATE_EMAIL_DRAFT:
    "Prepare one Gmail draft in the user's connected mailbox. A write: it runs only after the user approves this exact action on the canvas. It creates a draft and nothing else; Cardea cannot send mail.",
};

export type ComposioCapabilityExecution = (
  request: { userId: string; tool: string; input: Record<string, unknown> },
) => Promise<
  | {
      available: true;
      evidence: {
        origin: string;
        provider: "composio";
        toolSlug: string;
        digestSha256: string;
        excerpt: string;
        bytes: number;
        trust: "untrusted";
        capturedAt: string;
      };
    }
  | {
      available: false;
      reason:
        | "not_configured"
        | "tool_not_allowed"
        | "connection_required"
        | "circuit_open"
        | "timeout"
        | "provider_error";
      toolkit?: string;
    }
>;

export type ComposioCapabilityAdapterOptions = {
  identityId: string;
  enabled?: boolean;
  execute?: ComposioCapabilityExecution;
};

function asRecord(value: CapabilityExecutionRequest["input"]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class ComposioCapabilityAdapter implements CapabilityAdapter {
  readonly provider = "composio";

  constructor(private readonly options: ComposioCapabilityAdapterOptions) {}

  async discover(): Promise<NormalizedCapability[]> {
    if (!(this.options.enabled ?? Boolean(process.env.COMPOSIO_API_KEY))) return [];
    const readCapabilities: NormalizedCapability[] = COMPOSIO_SAFE_READ_CAPABILITIES.map(
      (capability) => ({
        id: capability.id,
        provider: this.provider,
        name: capability.tool,
        description: descriptions[capability.tool],
        inputSchema: inputSchemas[capability.tool],
        risk: { level: "low", categories: ["read"] },
        trust: {
          level: "derived",
          origin: COMPOSIO_PROVIDER_ORIGIN,
          provenance: `composio:${capability.tool}`,
        },
        readOnly: true,
      }),
    );
    // Declared with `external_write` so the deterministic policy engine reads
    // them for what they are. Medium rather than low because they change a
    // real account; not high, because a created event and a prepared draft
    // are both visible and reversible by the user. Neither is destructive,
    // and neither is a send.
    const writeCapabilities: NormalizedCapability[] = COMPOSIO_APPROVAL_GATED_CAPABILITIES.map(
      (capability) => ({
        id: capability.id,
        provider: this.provider,
        name: capability.tool,
        description: descriptions[capability.tool],
        inputSchema: inputSchemas[capability.tool],
        risk: { level: "medium", categories: ["external_write"] },
        trust: {
          level: "derived",
          origin: COMPOSIO_PROVIDER_ORIGIN,
          provenance: `composio:${capability.tool}`,
        },
        readOnly: false,
      }),
    );
    return [...readCapabilities, ...writeCapabilities];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const capability = [
      ...COMPOSIO_SAFE_READ_CAPABILITIES,
      ...COMPOSIO_APPROVAL_GATED_CAPABILITIES,
    ].find((candidate) => candidate.id === request.capabilityId) as
      | ComposioCapabilityEntry
      | undefined;
    if (!capability) throw new CapabilityProviderError(this.provider, "tool_not_allowed");

    const execute =
      this.options.execute ??
      (async (input: Parameters<ComposioCapabilityExecution>[0]) => {
        const composio = await import("./composio");
        return composio.executeComposioTool(input);
      });
    const result = await execute({
      userId: this.options.identityId,
      tool: capability.tool,
      input: asRecord(request.input),
    });

    if (!result.available) {
      if (result.reason === "connection_required") {
        throw new CapabilityConnectionRequiredError(
          this.provider,
          result.toolkit ?? capability.toolkit,
        );
      }
      throw new CapabilityProviderError(this.provider, result.reason);
    }

    const isWrite = COMPOSIO_APPROVAL_GATED_CAPABILITIES.some(
      (candidate) => candidate.id === capability.id,
    );
    return {
      executionId: request.idempotencyKey,
      // The same bounded receipt shape either way: a digest, a capped
      // excerpt, a size, a timestamp. A write returns the provider's own
      // bounded confirmation, never a raw connector payload.
      output: {
        tool: result.evidence.toolSlug,
        excerpt: result.evidence.excerpt,
        digestSha256: result.evidence.digestSha256,
        bytes: result.evidence.bytes,
        capturedAt: result.evidence.capturedAt,
      },
      summary: isWrite
        ? `Completed the approved write ${result.evidence.toolSlug} and captured a bounded receipt.`
        : `Captured bounded read-only evidence from ${result.evidence.toolSlug}.`,
      provenance: result.evidence.origin,
      trust: "untrusted",
    };
  }
}

