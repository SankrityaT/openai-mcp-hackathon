/**
 * Pure request rules for the Composio connections endpoints.
 *
 * Split out of the route modules for the same reason as
 * `shopify/execute-request.ts`: a Next.js route handler transitively imports
 * `server-only` and the Supabase client, so it cannot be loaded under plain
 * `node --test`. The rules that carry the security weight live here instead,
 * where they are actually tested:
 *
 *  - only a signed-in Supabase user may touch these endpoints (judge, guest,
 *    and anonymous principals are 401, not a degraded read),
 *  - the Composio entity id is taken from the session and from nowhere else,
 *    so a request body can never name another user's entity,
 *  - a connection id is bounded and opaque before it is ever looked up.
 */
// Relative rather than the `@/` alias: this module is compiled by
// `tsconfig.harness-tests.json` for `node --test`, which emits CommonJS
// without rewriting path aliases, matching every other tested module here.
import {
  isComposioConnectionToolkit,
  type ComposioConnectionToolkit,
} from "../../../../../harness/adapters/composio-connection-contract";

/** Mirrors `MissionPrincipal` without importing the server-only resolver. */
export type ConnectionPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "judge" }
  | { kind: "guest" }
  | { kind: "anonymous" };

export const CONNECTION_REQUEST_LIMITS = {
  maxConnectionIdChars: 120,
  maxBodyBytes: 1024,
} as const;

export type ConnectionRejection =
  | { status: 401; error: "authentication_required" }
  | { status: 400; error: "invalid_request" }
  | { status: 404; error: "not_found" };

export const AUTHENTICATION_REQUIRED: ConnectionRejection = {
  status: 401,
  error: "authentication_required",
};
export const INVALID_REQUEST: ConnectionRejection = { status: 400, error: "invalid_request" };
export const NOT_FOUND: ConnectionRejection = { status: 404, error: "not_found" };

/**
 * The Composio entity for a request, or a 401.
 *
 * Judge and guest sessions are deliberately refused rather than mapped onto
 * a shared entity: connecting a real Google account is personal, and those
 * two doors exist precisely so that no account is involved. Neither path is
 * changed by this refusal, they simply have nothing to connect.
 */
export function resolveConnectionEntity(
  principal: ConnectionPrincipal,
): { ok: true; entityId: string } | { ok: false; rejection: ConnectionRejection } {
  if (principal.kind !== "user" || principal.userId.length === 0) {
    return { ok: false, rejection: AUTHENTICATION_REQUIRED };
  }
  return { ok: true, entityId: principal.userId };
}

export type ConnectCommand = {
  /** Always the session's own user id. Never read from the request body. */
  entityId: string;
  toolkit: ComposioConnectionToolkit;
};

/**
 * Builds the connect command from the session principal plus the body.
 *
 * The body contributes exactly one thing: which toolkit. Any `userId`,
 * `entityId`, or `connectionId` a caller sends is ignored outright, so user A
 * cannot phrase a request that touches user B's entity.
 */
export function buildConnectCommand(
  principal: ConnectionPrincipal,
  body: unknown,
): { ok: true; command: ConnectCommand } | { ok: false; rejection: ConnectionRejection } {
  const entity = resolveConnectionEntity(principal);
  if (!entity.ok) return entity;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, rejection: INVALID_REQUEST };
  }
  const toolkit = (body as Record<string, unknown>).toolkit;
  if (!isComposioConnectionToolkit(toolkit)) {
    return { ok: false, rejection: INVALID_REQUEST };
  }
  return { ok: true, command: { entityId: entity.entityId, toolkit } };
}

export type DisconnectCommand = { entityId: string; connectionId: string };

/**
 * Bounds a path-supplied connection id before it reaches the provider. The
 * ownership decision is not made here: it is made by matching the id against
 * the caller's own entity listing, which is why an unknown or foreign id
 * comes back as 404 with nothing else said about it.
 */
export function buildDisconnectCommand(
  principal: ConnectionPrincipal,
  connectionId: unknown,
): { ok: true; command: DisconnectCommand } | { ok: false; rejection: ConnectionRejection } {
  const entity = resolveConnectionEntity(principal);
  if (!entity.ok) return entity;

  if (
    typeof connectionId !== "string" ||
    connectionId.length === 0 ||
    connectionId.length > CONNECTION_REQUEST_LIMITS.maxConnectionIdChars ||
    !/^[A-Za-z0-9_-]+$/.test(connectionId)
  ) {
    // Malformed ids fail as "not found" for the same reason foreign ids do:
    // the endpoint never distinguishes shapes of id it has not seen.
    return { ok: false, rejection: NOT_FOUND };
  }
  return { ok: true, command: { entityId: entity.entityId, connectionId } };
}

/**
 * The return address Composio sends the browser back to after managed OAuth.
 * Always the settings page on Cardea's own origin, with a bounded toolkit
 * marker so the page can say which row just returned. Composio appends its
 * own `status=success|failed`.
 */
export function buildConnectionCallbackUrl(
  appOrigin: string,
  toolkit: ComposioConnectionToolkit,
): string {
  const url = new URL("/settings/integrations", appOrigin);
  url.searchParams.set("toolkit", toolkit);
  return url.toString();
}
