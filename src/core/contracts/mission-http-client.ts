/**
 * Typed browser client for the Cardea mission routes.
 *
 * Dependency-free and transport-injectable so it can be unit tested against a
 * fake fetch. It never imports server code, never sees a service credential,
 * and bounds both what it sends and what it will read back.
 */

import type { QuotaDenial } from "./quota-errors";
import { parseQuotaDenial } from "./quota-errors";
import type {
  AuthorityPolicy,
  JsonValue,
  MissionApproval,
  MissionEvent,
  MissionEventType,
  MissionSnapshot,
  MissionStatus,
  NodeStatus,
  TrustLevel,
} from "./types";

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
    cache?: RequestCache;
  },
) => Promise<Response>;

export type CardeaSessionState = {
  authenticated: boolean;
  /** False when the deployment has no persistence configured at all. */
  configured: boolean;
  userId: string | null;
  guest: boolean;
  judge: boolean;
};

export class MissionHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly denial: QuotaDenial | null;

  constructor(status: number, code: string, denial: QuotaDenial | null = null) {
    super(`Cardea request failed (${status}:${code})`);
    this.name = "MissionHttpError";
    this.status = status;
    this.code = code;
    this.denial = denial;
  }
}

export type CreateMissionRequest = {
  title: string;
  goal: string;
  constraints: JsonValue[];
  authority: AuthorityPolicy;
  selectedContextCardIds: string[];
  budgetLimits: JsonValue;
  correlationId?: string;
};

export type AppendEventRequest = {
  expectedSequence: number;
  type: MissionEventType;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: JsonValue;
  trust: TrustLevel;
  missionStatus?: MissionStatus;
  nodeId?: string;
  nodeStatus?: NodeStatus;
};

export type ResolveApprovalRequest = {
  decision: "accepted" | "modified" | "rejected";
  resolution: JsonValue;
  correlationId: string;
  idempotencyKey: string;
};

const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 96 * 1024;
const EVENT_PAGE_LIMIT = 500;

export type CardeaMissionHttpClientOptions = {
  fetchImpl?: FetchLike;
  /** Same-origin by default. Only ever a Cardea origin. */
  basePath?: string;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export class CardeaMissionHttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly basePath: string;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;

  constructor(options: CardeaMissionHttpClientOptions = {}) {
    const injected = options.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else {
      const globalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
      if (!globalFetch) {
        throw new Error("A fetch implementation is required for the Cardea mission client");
      }
      this.fetchImpl = ((input, init) =>
        globalFetch(input, init as RequestInit)) as FetchLike;
    }
    this.basePath = (options.basePath ?? "").replace(/\/$/, "");
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
  ): Promise<{ status: number; data: T | null }> {
    let serialized: string | undefined;
    if (init.body !== undefined) {
      serialized = JSON.stringify(init.body);
      if (serialized === undefined || byteLength(serialized) > this.maxRequestBytes) {
        throw new MissionHttpError(0, "request_too_large");
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.basePath}${path}`, {
        method: init.method,
        headers: serialized === undefined ? {} : { "content-type": "application/json" },
        body: serialized,
        signal: init.signal,
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof MissionHttpError) throw error;
      if (init.signal?.aborted) throw new MissionHttpError(0, "aborted");
      throw new MissionHttpError(0, "network_error");
    }

    const text = await response.text();
    if (byteLength(text) > this.maxResponseBytes) {
      throw new MissionHttpError(response.status, "response_too_large");
    }

    let data: unknown = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new MissionHttpError(response.status, "invalid_response");
      }
    }

    if (!response.ok) {
      const denial = parseQuotaDenial(response.status, data);
      const reported = (data as { error?: unknown } | null)?.error;
      const code =
        denial !== null
          ? "quota_denied"
          : typeof reported === "string" && reported.length > 0 && reported.length <= 120
            ? reported
            : "request_failed";
      throw new MissionHttpError(response.status, code, denial);
    }

    return { status: response.status, data: (data ?? null) as T | null };
  }

  async getSession(signal?: AbortSignal): Promise<CardeaSessionState> {
    const { data } = await this.request<{
      authenticated?: unknown;
      configured?: unknown;
      userId?: unknown;
      guest?: unknown;
      judge?: unknown;
    }>("/api/session", { method: "GET", signal });
    return {
      authenticated: data?.authenticated === true,
      configured: data?.configured !== false,
      userId: typeof data?.userId === "string" ? data.userId : null,
      guest: data?.guest === true,
      judge: data?.judge === true,
    };
  }

  async createMission(
    body: CreateMissionRequest,
    signal?: AbortSignal,
  ): Promise<MissionSnapshot> {
    const { data } = await this.request<MissionSnapshot>("/api/missions", {
      method: "POST",
      body,
      signal,
    });
    if (!data) throw new MissionHttpError(201, "invalid_response");
    return data;
  }

  async getMission(missionId: string, signal?: AbortSignal): Promise<MissionSnapshot | null> {
    try {
      const { data } = await this.request<MissionSnapshot>(
        `/api/missions/${encodeURIComponent(missionId)}`,
        { method: "GET", signal },
      );
      return data;
    } catch (error) {
      if (error instanceof MissionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async listEvents(
    missionId: string,
    afterSequence = 0,
    signal?: AbortSignal,
  ): Promise<MissionEvent[]> {
    const after = Number.isSafeInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0;
    const { data } = await this.request<{ events?: MissionEvent[] }>(
      `/api/missions/${encodeURIComponent(missionId)}/events?after=${after}`,
      { method: "GET", signal },
    );
    const events = Array.isArray(data?.events) ? data.events : [];
    return events.slice(0, EVENT_PAGE_LIMIT);
  }

  async appendEvent(
    missionId: string,
    body: AppendEventRequest,
    signal?: AbortSignal,
  ): Promise<MissionEvent> {
    const { data } = await this.request<MissionEvent>(
      `/api/missions/${encodeURIComponent(missionId)}/events`,
      { method: "POST", body, signal },
    );
    if (!data) throw new MissionHttpError(201, "invalid_response");
    return data;
  }

  async resolveApproval(
    approvalId: string,
    body: ResolveApprovalRequest,
    signal?: AbortSignal,
  ): Promise<MissionApproval> {
    const { data } = await this.request<MissionApproval>(
      `/api/approvals/${encodeURIComponent(approvalId)}/resolve`,
      { method: "POST", body, signal },
    );
    if (!data) throw new MissionHttpError(200, "invalid_response");
    return data;
  }
}
