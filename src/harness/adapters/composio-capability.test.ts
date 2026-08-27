import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityConnectionRequiredError } from "../capability-errors";
import { ComposioCapabilityAdapter } from "./composio-capability";

test("discovers only the reviewed read-only Composio capabilities", async () => {
  const adapter = new ComposioCapabilityAdapter({
    identityId: "user-1",
    enabled: true,
    execute: async () => ({ available: false, reason: "provider_error" }),
  });
  const capabilities = await adapter.discover();
  assert.equal(capabilities.length, 4);
  assert.ok(capabilities.every((capability) => capability.readOnly));
  assert.ok(capabilities.every((capability) => capability.provider === "composio"));
  assert.ok(capabilities.every((capability) => capability.trust.level === "derived"));
});

test("turns a missing connector into a typed waiting boundary", async () => {
  const adapter = new ComposioCapabilityAdapter({
    identityId: "user-1",
    enabled: true,
    execute: async () => ({
      available: false,
      reason: "connection_required",
      toolkit: "gmail",
    }),
  });
  await assert.rejects(
    () =>
      adapter.execute({
        capabilityId: "composio.gmail_fetch_emails",
        missionId: "mission-1",
        nodeId: "node-1",
        input: { query: "move" },
        correlationId: "correlation-1",
        idempotencyKey: "idem-1",
      }),
    (error) =>
      error instanceof CapabilityConnectionRequiredError && error.toolkit === "gmail",
  );
});

test("returns only bounded evidence rather than a raw provider payload", async () => {
  const adapter = new ComposioCapabilityAdapter({
    identityId: "user-1",
    enabled: true,
    execute: async () => ({
      available: true,
      evidence: {
        origin: "composio:GMAIL_FETCH_EMAILS",
        provider: "composio",
        toolSlug: "GMAIL_FETCH_EMAILS",
        digestSha256: "a".repeat(64),
        excerpt: "bounded result",
        bytes: 14,
        trust: "untrusted",
        capturedAt: "2026-08-27T00:00:00.000Z",
      },
    }),
  });
  const result = await adapter.execute({
    capabilityId: "composio.gmail_fetch_emails",
    missionId: "mission-1",
    input: { query: "move" },
    correlationId: "correlation-1",
    idempotencyKey: "idem-1",
  });
  assert.equal(result.trust, "untrusted");
  assert.deepEqual(result.output, {
    tool: "GMAIL_FETCH_EMAILS",
    excerpt: "bounded result",
    digestSha256: "a".repeat(64),
    bytes: 14,
    capturedAt: "2026-08-27T00:00:00.000Z",
  });
});

