/**
 * Outbound cross-origin WebMCP consumption.
 *
 * Cardea embeds one explicitly configured companion origin in an `<iframe allow="tools">`,
 * discovers the tools that origin chose to expose with
 * `document.modelContext.getTools({ fromOrigins: [companionOrigin] })`, and executes them with
 * `document.modelContext.executeTool(tool, jsonInput, { signal })`.
 *
 * Every value crossing that boundary is untrusted evidence:
 *
 * - Tool names, titles, descriptions, and `inputSchema` come from the companion document. They
 *   are advertisements, never authority. This module narrows inputs with its own hard envelope
 *   and only ever uses the advertised schema to reject earlier, never to widen a limit.
 * - Results are byte-capped, digested, and wrapped with provenance before anything else in
 *   Cardea can read them. They are never treated as instructions.
 *
 * This module is deliberately DOM-framework free so it can be unit tested under `node:test`
 * with a fake `modelContext`. The React binding lives in `./use-companion-tools`.
 */

export const COMPANION_LIMITS = {
  /** Maximum tools accepted from one discovery call. */
  maxTools: 16,
  /** Maximum characters kept from any companion-supplied label. */
  maxLabelChars: 200,
  /** Maximum characters kept from a companion-supplied description. */
  maxDescriptionChars: 600,
  /** Maximum top-level keys in an input object. */
  maxInputKeys: 12,
  /** Maximum characters in any single input string. */
  maxInputStringChars: 400,
  /** Maximum items in an input array. */
  maxInputArrayItems: 8,
  /** Absolute integer bound for numeric input. */
  maxInputInteger: 10_000,
  /** Maximum serialized input size handed to the companion. */
  maxInputBytes: 4_096,
  /** Bytes of a result retained verbatim as a quotable excerpt. */
  maxExcerptBytes: 2_048,
  /** Bytes of a result read at all. Anything past this is discarded before digesting. */
  maxResultBytes: 32_768,
  /** Wall-clock budget for one cross-origin execution. */
  timeoutMs: 10_000,
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/* -------------------------------------------------------------------------- */
/* Origin handling                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a configured companion origin.
 *
 * Returns `null` for anything that is not a single concrete origin. Wildcards, credentials,
 * paths, and non-HTTPS schemes are rejected. Plain HTTP is accepted only for loopback hosts,
 * which is the documented local development path and is still a secure context in Chrome.
 */
export function normalizeCompanionOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && loopback) return url.origin;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Byte-bounded text handling                                                 */
/* -------------------------------------------------------------------------- */

export type CappedText = {
  text: string;
  bytes: number;
  totalBytes: number;
  truncated: boolean;
};

/**
 * Cap a string to `maxBytes` UTF-8 bytes without emitting a broken code point.
 * `totalBytes` always reports the true pre-truncation size so evidence stays honest.
 */
export function capUtf8(value: string, maxBytes: number): CappedText {
  const encoded = encoder.encode(value);
  if (encoded.byteLength <= maxBytes) {
    return { text: value, bytes: encoded.byteLength, totalBytes: encoded.byteLength, truncated: false };
  }
  let end = maxBytes;
  // Walk back off a UTF-8 continuation byte so the excerpt never ends mid-character.
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  const text = decoder.decode(encoded.subarray(0, end));
  return { text, bytes: end, totalBytes: encoded.byteLength, truncated: true };
}

function label(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  // Strip control characters so companion-supplied text cannot smuggle terminal or
  // line-structure tricks into Cardea's activity surface.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.slice(0, maxChars);
}

/* -------------------------------------------------------------------------- */
/* Digest                                                                     */
/* -------------------------------------------------------------------------- */

type SubtleLike = { digest(algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> };

function subtle(): SubtleLike | null {
  const candidate = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  return candidate && typeof candidate.digest === "function" ? candidate : null;
}

/**
 * SHA-256 hex digest of the UTF-8 bytes of `value`.
 *
 * Returns `null` when `crypto.subtle` is unavailable (an insecure context). Callers must record
 * the absence rather than substitute a weaker or invented value.
 */
export async function digestSha256(value: string): Promise<string | null> {
  const api = subtle();
  if (!api) return null;
  const buffer = await api.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Input bounding                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What Cardea is willing to send to a companion tool.
 *
 * Deliberately flat and JSON-safe: scalars, or arrays of scalars, one level deep. This is the
 * type-level expression of the bounding `boundCompanionInput` enforces at runtime, which is why
 * the resulting evidence payload can be stored as a mission event without any cast.
 */
export type CompanionInputScalar = string | number | boolean;
export type CompanionInputValue = CompanionInputScalar | CompanionInputScalar[];
export type CompanionInput = Record<string, CompanionInputValue>;

export class CompanionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionInputError";
  }
}

type AdvertisedSchema = {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  additionalProperties?: unknown;
};

function advertised(schema: unknown): AdvertisedSchema | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  return schema as AdvertisedSchema;
}

function boundScalar(value: unknown, path: string): CompanionInputScalar {
  if (typeof value === "string") {
    if (value.length > COMPANION_LIMITS.maxInputStringChars) {
      throw new CompanionInputError(`${path} exceeds ${COMPANION_LIMITS.maxInputStringChars} characters`);
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Math.abs(value) > COMPANION_LIMITS.maxInputInteger) {
      throw new CompanionInputError(`${path} must be an integer within ±${COMPANION_LIMITS.maxInputInteger}`);
    }
    return value;
  }
  throw new CompanionInputError(`${path} must be a string, integer, or boolean`);
}

/**
 * Narrow one tool input to Cardea's own hard envelope.
 *
 * The companion's advertised `inputSchema` is consulted only to reject unadvertised keys and to
 * require advertised required keys. It can never raise a limit, so a hostile companion cannot
 * widen what Cardea is willing to send.
 */
export function boundCompanionInput(
  input: unknown,
  schema?: unknown,
): { value: CompanionInput; json: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CompanionInputError("Tool input must be an object");
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > COMPANION_LIMITS.maxInputKeys) {
    throw new CompanionInputError(`Tool input exceeds ${COMPANION_LIMITS.maxInputKeys} keys`);
  }

  const shape = advertised(schema);
  const properties = shape && typeof shape.properties === "object" && shape.properties !== null
    ? (shape.properties as Record<string, unknown>)
    : null;

  const value: CompanionInput = {};
  for (const [key, raw] of entries) {
    if (key.length > 80) throw new CompanionInputError("Tool input key is too long");
    if (properties && !Object.prototype.hasOwnProperty.call(properties, key)) {
      throw new CompanionInputError(`Tool input key "${key}" is not advertised by the companion tool`);
    }
    if (Array.isArray(raw)) {
      if (raw.length > COMPANION_LIMITS.maxInputArrayItems) {
        throw new CompanionInputError(`${key} exceeds ${COMPANION_LIMITS.maxInputArrayItems} items`);
      }
      value[key] = raw.map((item, index) => boundScalar(item, `${key}[${index}]`));
      continue;
    }
    value[key] = boundScalar(raw, key);
  }

  if (shape && Array.isArray(shape.required)) {
    for (const key of shape.required) {
      if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(value, key)) {
        throw new CompanionInputError(`Tool input is missing required key "${key}"`);
      }
    }
  }

  const json = JSON.stringify(value);
  if (encoder.encode(json).byteLength > COMPANION_LIMITS.maxInputBytes) {
    throw new CompanionInputError(`Tool input exceeds ${COMPANION_LIMITS.maxInputBytes} bytes`);
  }
  return { value, json };
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

export type CompanionEvidence = {
  /** Origin the result came from. Always the exact configured companion origin. */
  origin: string;
  toolName: string;
  /** Whether the companion advertised the tool as read-only. Advisory, not a guarantee. */
  readOnly: boolean;
  /** The bounded input Cardea sent, after narrowing. */
  input: CompanionInput;
  /** SHA-256 of the full result string, or null when no digest API was available. */
  digest: string | null;
  digestAlgorithm: "sha-256";
  /** Byte-capped verbatim excerpt of the result. Never an instruction. */
  excerpt: string;
  excerptBytes: number;
  /** True size of the result before capping. */
  resultBytes: number;
  truncated: boolean;
  trust: "untrusted";
  capturedAt: string;
  durationMs: number;
};

/**
 * Wrap a raw companion result string as untrusted evidence with provenance.
 * The result is capped twice: once at `maxResultBytes` before digesting, and again at
 * `maxExcerptBytes` for the quotable excerpt.
 */
export async function wrapCompanionEvidence(options: {
  origin: string;
  toolName: string;
  readOnly: boolean;
  input: CompanionInput;
  result: string;
  capturedAt?: string;
  durationMs?: number;
}): Promise<CompanionEvidence> {
  const bounded = capUtf8(options.result, COMPANION_LIMITS.maxResultBytes);
  const excerpt = capUtf8(bounded.text, COMPANION_LIMITS.maxExcerptBytes);
  return {
    origin: options.origin,
    toolName: options.toolName,
    readOnly: options.readOnly,
    input: options.input,
    digest: await digestSha256(bounded.text),
    digestAlgorithm: "sha-256",
    excerpt: excerpt.text,
    excerptBytes: excerpt.bytes,
    resultBytes: bounded.totalBytes,
    truncated: bounded.truncated || excerpt.truncated,
    trust: "untrusted",
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    durationMs: options.durationMs ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Durable provenance seam                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The catalogued mission event that carries companion evidence.
 *
 * `evidence.recorded` is the only catalogued type whose stated purpose is "records evidence with
 * provenance and trust", and it does not materialize mission or node state — exactly right for a
 * third-party read or reversible simulated write. It is appended with `trust: "untrusted"`.
 */
export type CompanionEvidenceEvent = {
  type: "evidence.recorded";
  trust: "untrusted";
  payload: {
    source: "webmcp.companion";
    origin: string;
    toolName: string;
    readOnly: boolean;
    input: CompanionInput;
    digest: string | null;
    digestAlgorithm: "sha-256";
    excerpt: string;
    excerptBytes: number;
    resultBytes: number;
    truncated: boolean;
    capturedAt: string;
    durationMs: number;
  };
};

export type CompanionEvidenceReceipt = {
  persisted: boolean;
  /** Present only when the data source actually committed the event. */
  eventId?: string;
  sequence?: number;
  /** Truthful reason shown in the canvas when `persisted` is false. */
  reason?: string;
};

/**
 * Implemented by the live data source. Absent in fixture mode, where the canvas shows the
 * result and states plainly that nothing was persisted.
 */
export type CompanionEvidenceRecorder = (
  event: CompanionEvidenceEvent,
) => Promise<CompanionEvidenceReceipt>;

/**
 * Structural view of the mission transport this module needs, declared with method syntax so the
 * real `CardeaMissionHttpClient` satisfies it without this file importing server-adjacent code.
 */
export type CompanionEvidenceClient = {
  getMission(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<{ mission: { lastEventSequence: number } } | null>;
  appendEvent(
    missionId: string,
    body: {
      expectedSequence: number;
      type: "evidence.recorded";
      correlationId: string;
      idempotencyKey?: string;
      payload: CompanionEvidenceEvent["payload"];
      trust: "untrusted";
    },
    signal?: AbortSignal,
  ): Promise<{ id: string; sequence: number }>;
};

/** Optimistic-concurrency retries when another writer commits between our read and append. */
export const COMPANION_EVIDENCE_MAX_RETRIES = 2;

export function companionEvidenceIdempotencyKey(
  payload: CompanionEvidenceEvent["payload"],
): string {
  // Unique per invocation (capturedAt has millisecond resolution) but stable across retries of
  // that same invocation, so a sequence-conflict retry can never double-record one observation.
  const digest = payload.digest ? payload.digest.slice(0, 32) : "nodigest";
  return `evidence.recorded:${payload.toolName}:${payload.capturedAt}:${digest}`.slice(0, 200);
}

/**
 * Append one companion result to the mission log as untrusted evidence.
 *
 * Transport-agnostic and side-effect-honest: it reads the authoritative committed sequence rather
 * than trusting a cached one, retries only a genuine sequence race, and never reports
 * `persisted: true` unless the server returned a committed event.
 */
export async function appendCompanionEvidence(options: {
  client: CompanionEvidenceClient;
  missionId: string | null;
  event: CompanionEvidenceEvent;
  /** Maps a transport error to a truthful, user-facing reason. */
  describeFailure: (error: unknown) => string;
  /** True when the error is a sequence conflict worth one more attempt. */
  isSequenceConflict: (error: unknown) => boolean;
  newCorrelationId: () => string;
  signal?: AbortSignal;
}): Promise<CompanionEvidenceReceipt> {
  if (!options.missionId) {
    return {
      persisted: false,
      reason:
        "Live mode is active but this session has no mission yet, so there is nothing to attach the evidence to. Create a mission first.",
    };
  }

  const key = companionEvidenceIdempotencyKey(options.event.payload);
  let reason = "The companion result was not recorded.";

  for (let attempt = 0; attempt <= COMPANION_EVIDENCE_MAX_RETRIES; attempt += 1) {
    try {
      const snapshot = await options.client.getMission(options.missionId, options.signal);
      if (!snapshot) {
        return {
          persisted: false,
          reason: "That mission is no longer readable, so the companion result was not recorded.",
        };
      }
      const committed = await options.client.appendEvent(
        options.missionId,
        {
          expectedSequence: snapshot.mission.lastEventSequence,
          type: "evidence.recorded",
          correlationId: options.newCorrelationId(),
          idempotencyKey: key,
          payload: options.event.payload,
          // Never negotiable: captured external content is untrusted evidence.
          trust: "untrusted",
        },
        options.signal,
      );
      return { persisted: true, eventId: committed.id, sequence: committed.sequence };
    } catch (error) {
      reason = options.describeFailure(error);
      if (!options.isSequenceConflict(error) || attempt === COMPANION_EVIDENCE_MAX_RETRIES) {
        return { persisted: false, reason };
      }
    }
  }
  return { persisted: false, reason };
}

export function toCompanionEvidenceEvent(evidence: CompanionEvidence): CompanionEvidenceEvent {
  return {
    type: "evidence.recorded",
    trust: "untrusted",
    payload: {
      source: "webmcp.companion",
      origin: evidence.origin,
      toolName: evidence.toolName,
      readOnly: evidence.readOnly,
      input: evidence.input,
      digest: evidence.digest,
      digestAlgorithm: evidence.digestAlgorithm,
      excerpt: evidence.excerpt,
      excerptBytes: evidence.excerptBytes,
      resultBytes: evidence.resultBytes,
      truncated: evidence.truncated,
      capturedAt: evidence.capturedAt,
      durationMs: evidence.durationMs,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

export type CompanionToolSummary = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  untrustedContent: boolean;
  origin: string;
  inputSchema: unknown;
};

export type CompanionDiscovery =
  | { status: "ready"; tools: CompanionToolSummary[] }
  | { status: "not-configured"; reason: string }
  | { status: "unsupported"; reason: string }
  | { status: "empty"; reason: string }
  | { status: "error"; reason: string };

export type CompanionExecution =
  | { status: "ok"; evidence: CompanionEvidence }
  | { status: "navigated"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string };

/**
 * Minimal structural view of the parts of `document.modelContext` this adapter consumes.
 * Declared with method syntax so a real `CardeaModelContext` and a test fake both satisfy it.
 */
export type CompanionModelContext = {
  getTools?(options?: { fromOrigins?: string[] }): Promise<unknown>;
  executeTool?(
    tool: unknown,
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
};

export type CompanionToolAdapter = {
  supported: boolean;
  origin: string | null;
  discover(): Promise<CompanionDiscovery>;
  execute(toolName: string, input: unknown): Promise<CompanionExecution>;
};

function summarize(tool: unknown, origin: string): CompanionToolSummary | null {
  if (!tool || typeof tool !== "object") return null;
  const record = tool as Record<string, unknown>;
  const name = label(record.name, COMPANION_LIMITS.maxLabelChars);
  if (!name) return null;
  // Defence in depth: never surface a handle whose reported origin is not the allowlisted one.
  const reported = typeof record.origin === "string" ? normalizeCompanionOrigin(record.origin) : null;
  if (reported && reported !== origin) return null;
  const annotations = (record.annotations ?? {}) as Record<string, unknown>;
  return {
    name,
    title: label(record.title, COMPANION_LIMITS.maxLabelChars) || name,
    description: label(record.description, COMPANION_LIMITS.maxDescriptionChars),
    readOnly: annotations.readOnlyHint === true,
    untrustedContent: annotations.untrustedContentHint === true,
    origin,
    inputSchema: record.inputSchema,
  };
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return label(message, 240) || "Unknown error";
}

/**
 * Build a feature-detected adapter over one companion origin.
 *
 * Every failure mode is explicit and truthful:
 * - no configured origin -> `not-configured`
 * - no `document.modelContext`, or no `getTools`/`executeTool` -> `unsupported`
 * - origin exposes nothing to Cardea -> `empty`
 *
 * No path ever invents a tool list or a result.
 */
export function createCompanionToolAdapter(options: {
  origin: string | null | undefined;
  modelContext: CompanionModelContext | null | undefined;
  timeoutMs?: number;
  now?: () => number;
}): CompanionToolAdapter {
  const origin = normalizeCompanionOrigin(options.origin);
  const context = options.modelContext ?? null;
  const timeoutMs = options.timeoutMs ?? COMPANION_LIMITS.timeoutMs;
  const now = options.now ?? (() => Date.now());
  const supported =
    origin !== null &&
    context !== null &&
    typeof context.getTools === "function" &&
    typeof context.executeTool === "function";

  let handles = new Map<string, { handle: unknown; summary: CompanionToolSummary }>();

  /** Every non-ready discovery state carries a human-readable reason. */
  function unavailable(): Extract<CompanionDiscovery, { reason: string }> | null {
    if (!origin) {
      return {
        status: "not-configured",
        reason: "No companion origin is configured. Set NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN to an exact HTTPS origin.",
      };
    }
    if (!context) {
      return {
        status: "unsupported",
        reason: "This browser does not expose document.modelContext, so cross-origin WebMCP discovery is unavailable.",
      };
    }
    if (typeof context.getTools !== "function" || typeof context.executeTool !== "function") {
      return {
        status: "unsupported",
        reason: "This browser exposes document.modelContext but not getTools()/executeTool(), so cross-origin WebMCP discovery is unavailable.",
      };
    }
    return null;
  }

  return {
    supported,
    origin,

    async discover(): Promise<CompanionDiscovery> {
      const blocked = unavailable();
      if (blocked) return blocked;
      const allowlisted = origin as string;
      const getTools = context?.getTools;
      if (!getTools || !context) return { status: "error", reason: "getTools() is unavailable." };
      try {
        // Explicit single-origin allowlist. Never a wildcard, never an inferred origin.
        const returned = await getTools.call(context, { fromOrigins: [allowlisted] });
        if (!Array.isArray(returned)) {
          return { status: "error", reason: "getTools() did not return a tool list." };
        }
        const next = new Map<string, { handle: unknown; summary: CompanionToolSummary }>();
        for (const candidate of returned.slice(0, COMPANION_LIMITS.maxTools)) {
          const summary = summarize(candidate, allowlisted);
          if (summary && !next.has(summary.name)) next.set(summary.name, { handle: candidate, summary });
        }
        handles = next;
        const tools = [...next.values()].map((entry) => entry.summary);
        if (tools.length === 0) {
          return {
            status: "empty",
            reason: `${allowlisted} exposed no tools to this origin. Check the companion's exposedTo allowlist.`,
          };
        }
        return { status: "ready", tools };
      } catch (error) {
        return { status: "error", reason: reason(error) };
      }
    },

    async execute(toolName: string, input: unknown): Promise<CompanionExecution> {
      const blocked = unavailable();
      if (blocked) return { status: "rejected", reason: blocked.reason };
      const executeTool = context?.executeTool;
      if (!executeTool || !context) return { status: "error", reason: "executeTool() is unavailable." };
      const entry = handles.get(toolName);
      if (!entry) {
        return {
          status: "rejected",
          reason: `"${label(toolName, 80)}" is not a currently discovered companion tool. Run discovery first.`,
        };
      }

      let bounded: { value: CompanionInput; json: string };
      try {
        bounded = boundCompanionInput(input, entry.summary.inputSchema);
      } catch (error) {
        return { status: "rejected", reason: reason(error) };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = now();
      try {
        // Chrome's imperative API takes the input as a JSON string.
        const raw = await executeTool.call(context, entry.handle, bounded.json, {
          signal: controller.signal,
        });
        if (raw === null || raw === undefined) {
          return {
            status: "navigated",
            reason: "The companion tool returned no result, which the WebMCP API reports when the frame navigates.",
          };
        }
        if (typeof raw !== "string") {
          return { status: "error", reason: "The companion tool returned a non-string result." };
        }
        const evidence = await wrapCompanionEvidence({
          origin: entry.summary.origin,
          toolName: entry.summary.name,
          readOnly: entry.summary.readOnly,
          input: bounded.value,
          result: raw,
          durationMs: Math.max(0, now() - startedAt),
        });
        return { status: "ok", evidence };
      } catch (error) {
        if (controller.signal.aborted) {
          return { status: "error", reason: `The companion tool did not respond within ${timeoutMs}ms and was aborted.` };
        }
        return { status: "error", reason: reason(error) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
