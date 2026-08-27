import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityConnectionRequiredError } from "../capability-errors";
import { ComposioCapabilityAdapter } from "./composio-capability";

test("discovers only the reviewed Composio capabilities", async () => {
  const adapter = new ComposioCapabilityAdapter({
    identityId: "user-1",
    enabled: true,
    execute: async () => ({ available: false, reason: "provider_error" }),
  });
  const capabilities = await adapter.discover();
  assert.equal(capabilities.length, 6);
  assert.ok(capabilities.every((capability) => capability.provider === "composio"));
  assert.ok(capabilities.every((capability) => capability.trust.level === "derived"));

  const reads = capabilities.filter((capability) => capability.readOnly);
  assert.equal(reads.length, 4);
  assert.ok(reads.every((capability) => capability.risk.level === "low"));
  assert.ok(reads.every((capability) => capability.risk.categories.includes("read")));
});

test("declares exactly two writes, both as external_write, and no send", async () => {
  const adapter = new ComposioCapabilityAdapter({
    identityId: "user-1",
    enabled: true,
    execute: async () => ({ available: false, reason: "provider_error" }),
  });
  const writes = (await adapter.discover()).filter((capability) => !capability.readOnly);

  assert.deepEqual(
    writes.map((capability) => capability.id).sort(),
    ["composio.gmail_create_email_draft", "composio.googlecalendar_create_event"],
  );
  assert.ok(writes.every((capability) => capability.risk.level === "medium"));
  assert.ok(writes.every((capability) => capability.risk.categories.includes("external_write")));
  // The absent capability is the point: Cardea has no way to send mail.
  assert.ok(writes.every((capability) => !capability.name.includes("SEND")));
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

