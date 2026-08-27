import "server-only";

import { cookies } from "next/headers";
import { decodeSignedCookie, encodeSignedCookie, isSha256Hex } from "./credentials";

export const GUEST_SESSION_COOKIE = "cardea_guest_session";
export const JUDGE_ACCESS_COOKIE = "cardea_judge_access";

export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24;
export const JUDGE_ACCESS_TTL_SECONDS = 60 * 60 * 12;

const JUDGE_PAYLOAD_PREFIX = "judge:v1:";

/**
 * Optional HMAC secret for server-issued session cookies. When present, guest
 * and judge cookies must carry a valid signature. Judge access additionally
 * requires it, because a judge cookie is an assertion rather than a lookup key.
 */
export function getSessionSigningSecret(): string | null {
  const secret = process.env.CARDEA_SESSION_SECRET;
  return typeof secret === "string" && secret.length >= 16 ? secret : null;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function readGuestSessionToken(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(GUEST_SESSION_COOKIE)?.value;
  const token = decodeSignedCookie(raw, getSessionSigningSecret());
  if (!token || token.length < 32 || token.length > 256) return null;
  return token;
}

export async function writeGuestSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(
    GUEST_SESSION_COOKIE,
    encodeSignedCookie(token, getSessionSigningSecret()),
    cookieOptions(GUEST_SESSION_TTL_SECONDS),
  );
}

/**
 * Returns the judge code hash asserted by the current session cookie.
 * Without a signing secret no judge cookie is ever trusted.
 */
export async function readJudgeCodeHash(): Promise<string | null> {
  const secret = getSessionSigningSecret();
  if (!secret) return null;
  const store = await cookies();
  const payload = decodeSignedCookie(store.get(JUDGE_ACCESS_COOKIE)?.value, secret);
  if (!payload || !payload.startsWith(JUDGE_PAYLOAD_PREFIX)) return null;
  const codeHash = payload.slice(JUDGE_PAYLOAD_PREFIX.length);
  return isSha256Hex(codeHash) ? codeHash : null;
}

export async function writeJudgeAccessCookie(codeHash: string): Promise<void> {
  const secret = getSessionSigningSecret();
  if (!secret || !isSha256Hex(codeHash)) return;
  const store = await cookies();
  store.set(
    JUDGE_ACCESS_COOKIE,
    encodeSignedCookie(`${JUDGE_PAYLOAD_PREFIX}${codeHash}`, secret),
    cookieOptions(JUDGE_ACCESS_TTL_SECONDS),
  );
}
