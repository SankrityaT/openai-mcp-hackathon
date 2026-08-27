import { createHash } from "node:crypto";

/**
 * Produces a stable RFC 4122-shaped UUID from bounded server-owned parts.
 * Durable step retries must recreate the same node and edge ids, otherwise
 * the repository correctly reports an idempotency-key payload conflict.
 */
export function deterministicUuid(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
  const chars = [...hex];
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

