/**
 * Dependency-free credential primitives for guest sessions and judge codes.
 *
 * This module holds no secret of its own: every secret is passed in by a caller
 * that read it from server-only configuration. Nothing here is ever imported by
 * client code, and nothing here logs or returns a raw secret.
 *
 * It intentionally does not import `server-only`, so the primitives stay
 * unit-testable under `node --test`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * Constant-time comparison of two hex digests. Returns false for anything that
 * is not a well-formed digest instead of throwing, so callers can treat an
 * absent or malformed configuration value as "no match".
 */
export function constantTimeHexEqual(left: unknown, right: unknown): boolean {
  const a = typeof left === "string" ? left.trim().toLowerCase() : "";
  const b = typeof right === "string" ? right.trim().toLowerCase() : "";
  if (!isSha256Hex(a) || !isSha256Hex(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Compares a submitted judge code against the configured SHA-256 hash.
 * Only hashes are ever stored or compared.
 */
export function matchesJudgeCode(code: unknown, expectedHash: unknown): boolean {
  if (typeof code !== "string" || code.length < 1 || code.length > 200) return false;
  return constantTimeHexEqual(sha256Hex(code), expectedHash);
}

/** High-entropy opaque token for a guest cookie. Never stored in plaintext. */
export function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

export function signValue(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function verifySignedValue(
  secret: string,
  value: string,
  signature: unknown,
): boolean {
  return constantTimeHexEqual(signValue(secret, value), signature);
}

const SIGNATURE_SEPARATOR = ".";

/** `<value>.<hmac>` when a signing secret exists, otherwise the bare value. */
export function encodeSignedCookie(value: string, secret: string | null): string {
  if (!secret) return value;
  return `${value}${SIGNATURE_SEPARATOR}${signValue(secret, value)}`;
}

/**
 * Returns the payload only when the signature requirement is satisfied.
 * When a secret is configured, an unsigned or wrongly signed cookie is rejected.
 */
export function decodeSignedCookie(
  cookieValue: unknown,
  secret: string | null,
): string | null {
  if (typeof cookieValue !== "string" || cookieValue.length === 0 || cookieValue.length > 4096) {
    return null;
  }
  const separator = cookieValue.lastIndexOf(SIGNATURE_SEPARATOR);
  if (!secret) {
    return separator === -1 ? cookieValue : cookieValue.slice(0, separator);
  }
  if (separator <= 0) return null;
  const value = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  return verifySignedValue(secret, value, signature) ? value : null;
}

/**
 * Hashes an IP address into an abuse signal. The result is never an identity:
 * it is only ever compared against other hashes for rate-limit heuristics.
 */
export function hashIpSignal(ip: unknown, salt: string): string | null {
  if (typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return sha256Hex(`${salt}:${trimmed}`);
}
