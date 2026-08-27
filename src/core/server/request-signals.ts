import "server-only";

import { hashIpSignal } from "./credentials";
import { getSessionSigningSecret } from "./session-cookies";

const IP_SALT_FALLBACK = "cardea-ip-abuse-signal";

/**
 * Derives a hashed abuse signal from the request. The raw address is never
 * stored, logged, or returned, and the hash is never treated as an identity.
 */
export function readIpSignalHash(request: Request): string | undefined {
  const forwarded =
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (!first) return undefined;
  return hashIpSignal(first, getSessionSigningSecret() ?? IP_SALT_FALLBACK) ?? undefined;
}
