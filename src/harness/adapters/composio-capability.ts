import {
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

const inputSchemas: Record<SafeComposioCapability["tool"], NormalizedCapability["inputSchema"]> = {
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
};

const descriptions: Record<SafeComposioCapability["tool"], string> = {
  GOOGLECALENDAR_FIND_EVENT:
    "Find matching events in the user's connected Google Calendar. Read-only and connection-scoped.",
  GOOGLECALENDAR_FIND_FREE_SLOTS:
    "Find bounded free windows in the user's connected Google Calendar. Read-only and connection-scoped.",
  GMAIL_FETCH_EMAILS:
    "Search a user-authorized Gmail mailbox and return bounded message evidence. Read-only.",
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID:
    "Read one user-selected Gmail message by its exact message id. Read-only.",
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
    return COMPOSIO_SAFE_READ_CAPABILITIES.map((capability) => ({
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
    }));
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const capability = COMPOSIO_SAFE_READ_CAPABILITIES.find(
      (candidate) => candidate.id === request.capabilityId,
    );
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

    return {
      executionId: request.idempotencyKey,
      output: {
        tool: result.evidence.toolSlug,
        excerpt: result.evidence.excerpt,
        digestSha256: result.evidence.digestSha256,
        bytes: result.evidence.bytes,
        capturedAt: result.evidence.capturedAt,
      },
      summary: `Captured bounded read-only evidence from ${result.evidence.toolSlug}.`,
      provenance: result.evidence.origin,
      trust: "untrusted",
    };
  }
}

