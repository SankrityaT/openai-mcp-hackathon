import { createHash } from "node:crypto";
import type { JsonValue } from "./contracts/types";

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry as JsonValue)}`).join(",")}}`;
}

export type IdempotencyKeyInput = {
  missionId: string;
  nodeId?: string;
  capabilityId: string;
  action: string;
  mandateVersion: number;
  request: JsonValue;
};

export function fingerprintRequest(request: JsonValue): string {
  return createHash("sha256").update(canonicalize(request)).digest("hex");
}

export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  const scope = [
    "cardea-v1",
    input.missionId,
    input.nodeId ?? "mission",
    input.capabilityId,
    input.action,
    String(input.mandateVersion),
    fingerprintRequest(input.request),
  ].join(":");
  return `idem_${createHash("sha256").update(scope).digest("hex")}`;
}
