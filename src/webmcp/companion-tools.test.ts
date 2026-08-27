import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCompanionEvidence,
  companionEvidenceIdempotencyKey,
  COMPANION_EVIDENCE_MAX_RETRIES,
  type CompanionEvidenceClient,
  boundCompanionInput,
  capUtf8,
  COMPANION_LIMITS,
  CompanionInputError,
  createCompanionToolAdapter,
  digestSha256,
  normalizeCompanionOrigin,
  toCompanionEvidenceEvent,
  wrapCompanionEvidence,
  type CompanionModelContext,
} from "./companion-tools";

const COMPANION = "https://companion.example";
const SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { query: { type: "string", minLength: 1, maxLength: 120 } },
  required: ["query"],
};

function fakeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "search_catalog",
    title: "Search catalog",
    description: "Search the visible catalog.",
    inputSchema: SEARCH_SCHEMA,
    annotations: { readOnlyHint: true },
    origin: COMPANION,
    ...overrides,
  };
}

/** A stand-in for `document.modelContext` that records what the adapter asked for. */
function fakeContext(options: {
  tools?: unknown;
  result?: string | null;
  fail?: Error;
  hang?: boolean;
}): CompanionModelContext & { calls: { fromOrigins?: string[]; input?: string }[] } {
  const calls: { fromOrigins?: string[]; input?: string }[] = [];
  return {
    calls,
    async getTools(discovery) {
      calls.push({ fromOrigins: discovery?.fromOrigins });
      return options.tools ?? [fakeTool()];
    },
    async executeTool(_tool, input, execution) {
      calls.push({ input });
      if (options.fail) throw options.fail;
      if (options.hang) {
        return new Promise((_resolve, reject) => {
          execution?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return options.result === undefined ? '{"results":[]}' : options.result;
    },
  };
}

/* -------------------------------------------------------------------------- */

test("origin normalization accepts one concrete origin and rejects everything looser", () => {
  assert.equal(normalizeCompanionOrigin("https://companion.example/"), COMPANION);
  assert.equal(normalizeCompanionOrigin("  https://companion.example  "), COMPANION);
  assert.equal(normalizeCompanionOrigin("http://localhost:4321"), "http://localhost:4321");
  assert.equal(normalizeCompanionOrigin("http://127.0.0.1:4321"), "http://127.0.0.1:4321");

  assert.equal(normalizeCompanionOrigin("https://*.example"), null, "wildcards are rejected");
  assert.equal(normalizeCompanionOrigin("http://companion.example"), null, "plain HTTP is rejected");
  assert.equal(normalizeCompanionOrigin("https://companion.example/tools"), null, "paths are rejected");
  assert.equal(normalizeCompanionOrigin("https://u:p@companion.example"), null, "credentials are rejected");
  assert.equal(normalizeCompanionOrigin("not a url"), null);
  assert.equal(normalizeCompanionOrigin(null), null);
  assert.equal(normalizeCompanionOrigin(undefined), null);
});

test("byte capping truncates on a character boundary and reports the true size", () => {
  const short = capUtf8("abc", 10);
  assert.deepEqual(short, { text: "abc", bytes: 3, totalBytes: 3, truncated: false });

  // "é" is two UTF-8 bytes, so a 3-byte cap must drop it rather than split it.
  const split = capUtf8("aéb", 2);
  assert.equal(split.truncated, true);
  assert.equal(split.text, "a");
  assert.equal(split.bytes, 1);
  assert.equal(split.totalBytes, 4);
  assert.ok(!split.text.includes("�"), "never emits a replacement character");

  const emoji = capUtf8("🙂🙂", 5);
  assert.equal(emoji.text, "🙂");
  assert.equal(emoji.totalBytes, 8);
});

test("digest is a stable sha-256 hex of the utf-8 bytes", async () => {
  assert.equal(
    await digestSha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(await digestSha256(""), (await digestSha256("")) as string);
});

test("input bounding enforces Cardea's envelope and the advertised shape", () => {
  const bounded = boundCompanionInput({ query: "lamp" }, SEARCH_SCHEMA);
  assert.deepEqual(bounded.value, { query: "lamp" });
  assert.equal(bounded.json, '{"query":"lamp"}');

  assert.throws(() => boundCompanionInput("lamp", SEARCH_SCHEMA), CompanionInputError);
  assert.throws(() => boundCompanionInput([], SEARCH_SCHEMA), CompanionInputError);
  assert.throws(
    () => boundCompanionInput({ query: "a", extra: "b" }, SEARCH_SCHEMA),
    /not advertised/,
    "unadvertised keys are refused",
  );
  assert.throws(() => boundCompanionInput({}, SEARCH_SCHEMA), /missing required key/);
  assert.throws(
    () => boundCompanionInput({ query: "x".repeat(COMPANION_LIMITS.maxInputStringChars + 1) }, SEARCH_SCHEMA),
    /exceeds 400 characters/,
  );
  assert.throws(
    () => boundCompanionInput({ query: { nested: true } }, SEARCH_SCHEMA),
    /must be a string, integer, or boolean/,
    "nested objects never cross the boundary",
  );
});

test("input bounding ignores a hostile schema that tries to widen limits", () => {
  // The companion advertises a 1MB string. Cardea's own envelope still wins.
  const hostile = {
    type: "object",
    properties: { query: { type: "string", maxLength: 1_000_000 } },
  };
  assert.throws(
    () => boundCompanionInput({ query: "x".repeat(5_000) }, hostile),
    /exceeds 400 characters/,
  );
});

test("input bounding caps integers, arrays, key count, and serialized bytes", () => {
  const cartSchema = {
    type: "object",
    properties: { itemId: { type: "string" }, quantity: { type: "integer" } },
    required: ["itemId", "quantity"],
  };
  assert.deepEqual(
    boundCompanionInput({ itemId: "lumen-lamp", quantity: 2 }, cartSchema).value,
    { itemId: "lumen-lamp", quantity: 2 },
  );
  assert.throws(() => boundCompanionInput({ itemId: "a", quantity: 1.5 }, cartSchema), /integer/);
  assert.throws(() => boundCompanionInput({ itemId: "a", quantity: 99_999 }, cartSchema), /integer/);

  const listSchema = { type: "object", properties: { itemIds: { type: "array" } } };
  assert.throws(
    () => boundCompanionInput({ itemIds: Array.from({ length: 20 }, (_, i) => `i${i}`) }, listSchema),
    /exceeds 8 items/,
  );

  // With no advertised schema the envelope alone applies.
  const many = Object.fromEntries(
    Array.from({ length: COMPANION_LIMITS.maxInputKeys + 1 }, (_, i) => [`k${i}`, "v"]),
  );
  assert.throws(() => boundCompanionInput(many), /exceeds 12 keys/);

  const fat = Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`k${i}`, "x".repeat(COMPANION_LIMITS.maxInputStringChars)]),
  );
  assert.throws(() => boundCompanionInput(fat), /exceeds 4096 bytes/);
});

test("evidence wrapping carries provenance, digest, and honest byte accounting", async () => {
  const result = "y".repeat(COMPANION_LIMITS.maxExcerptBytes + 500);
  const evidence = await wrapCompanionEvidence({
    origin: COMPANION,
    toolName: "search_catalog",
    readOnly: true,
    input: { query: "lamp" },
    result,
    capturedAt: "2026-08-26T00:00:00.000Z",
    durationMs: 12,
  });

  assert.equal(evidence.trust, "untrusted");
  assert.equal(evidence.origin, COMPANION);
  assert.equal(evidence.toolName, "search_catalog");
  assert.equal(evidence.readOnly, true);
  assert.equal(evidence.capturedAt, "2026-08-26T00:00:00.000Z");
  assert.equal(evidence.durationMs, 12);
  assert.equal(evidence.digestAlgorithm, "sha-256");
  assert.equal(evidence.digest, await digestSha256(result));
  assert.equal(evidence.excerptBytes, COMPANION_LIMITS.maxExcerptBytes);
  assert.equal(evidence.excerpt.length, COMPANION_LIMITS.maxExcerptBytes);
  assert.equal(evidence.resultBytes, result.length, "reports the pre-truncation size");
  assert.equal(evidence.truncated, true);
});

test("evidence discards anything past the hard result cap before digesting", async () => {
  const oversized = "z".repeat(COMPANION_LIMITS.maxResultBytes + 4_096);
  const evidence = await wrapCompanionEvidence({
    origin: COMPANION,
    toolName: "read_policies",
    readOnly: true,
    input: {},
    result: oversized,
  });
  assert.equal(evidence.resultBytes, COMPANION_LIMITS.maxResultBytes + 4_096);
  assert.equal(
    evidence.digest,
    await digestSha256("z".repeat(COMPANION_LIMITS.maxResultBytes)),
    "digests only the bytes actually retained",
  );
});

test("evidence maps onto the evidence.recorded mission event as untrusted", async () => {
  const evidence = await wrapCompanionEvidence({
    origin: COMPANION,
    toolName: "update_cart",
    readOnly: false,
    input: { itemId: "lumen-lamp", quantity: 2 },
    result: '{"items":[{"id":"lumen-lamp","quantity":2}],"simulated":true}',
  });
  const event = toCompanionEvidenceEvent(evidence);
  assert.equal(event.type, "evidence.recorded");
  assert.equal(event.trust, "untrusted");
  assert.equal(event.payload.source, "webmcp.companion");
  assert.equal(event.payload.origin, COMPANION);
  assert.equal(event.payload.readOnly, false);
  assert.deepEqual(event.payload.input, { itemId: "lumen-lamp", quantity: 2 });
});

/* -------------------------------------------------------------------------- */
/* Adapter feature detection and no-op paths                                  */
/* -------------------------------------------------------------------------- */

test("adapter reports not-configured when no origin is set, and never calls the API", async () => {
  const context = fakeContext({});
  const adapter = createCompanionToolAdapter({ origin: null, modelContext: context });
  assert.equal(adapter.supported, false);
  assert.equal(adapter.origin, null);

  const discovery = await adapter.discover();
  assert.equal(discovery.status, "not-configured");
  const execution = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(execution.status, "rejected");
  assert.equal(context.calls.length, 0, "no cross-origin call is attempted");
});

test("adapter reports unsupported without modelContext or without getTools/executeTool", async () => {
  const missing = createCompanionToolAdapter({ origin: COMPANION, modelContext: null });
  assert.equal(missing.supported, false);
  const noContext = await missing.discover();
  assert.equal(noContext.status, "unsupported");
  assert.match(noContext.reason, /does not expose document\.modelContext/);

  // A browser with registerTool but no cross-origin consumption API.
  const partial = createCompanionToolAdapter({ origin: COMPANION, modelContext: {} });
  assert.equal(partial.supported, false);
  const noMethods = await partial.discover();
  assert.equal(noMethods.status, "unsupported");
  assert.match(noMethods.reason, /getTools\(\)\/executeTool\(\)/);
});

test("adapter discovers only from the explicit single-origin allowlist", async () => {
  const context = fakeContext({});
  const adapter = createCompanionToolAdapter({ origin: COMPANION, modelContext: context });
  assert.equal(adapter.supported, true);

  const discovery = await adapter.discover();
  assert.equal(discovery.status, "ready");
  assert.deepEqual(context.calls[0].fromOrigins, [COMPANION], "exactly one origin, no wildcard");
  if (discovery.status !== "ready") throw new Error("unreachable");
  assert.equal(discovery.tools.length, 1);
  assert.equal(discovery.tools[0].name, "search_catalog");
  assert.equal(discovery.tools[0].readOnly, true);
  assert.equal(discovery.tools[0].origin, COMPANION);
});

test("adapter drops handles whose reported origin is not the allowlisted one", async () => {
  const context = fakeContext({
    tools: [fakeTool({ origin: "https://elsewhere.example", name: "impostor" }), fakeTool()],
  });
  const discovery = await createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: context,
  }).discover();
  if (discovery.status !== "ready") throw new Error(`expected ready, got ${discovery.status}`);
  assert.deepEqual(discovery.tools.map((tool) => tool.name), ["search_catalog"]);
});

test("adapter states plainly when the origin exposes nothing", async () => {
  const discovery = await createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: fakeContext({ tools: [] }),
  }).discover();
  assert.equal(discovery.status, "empty");
  assert.match(discovery.reason, /exposedTo/);
});

test("adapter refuses to execute a tool that was never discovered", async () => {
  const adapter = createCompanionToolAdapter({ origin: COMPANION, modelContext: fakeContext({}) });
  const before = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(before.status, "rejected");
  assert.match(before.reason, /not a currently discovered companion tool/);

  await adapter.discover();
  const unknown = await adapter.execute("delete_everything", {});
  assert.equal(unknown.status, "rejected");
});

test("adapter executes with a JSON string and wraps the result as untrusted evidence", async () => {
  const context = fakeContext({ result: '{"results":[{"id":"lumen-lamp"}]}' });
  const adapter = createCompanionToolAdapter({ origin: COMPANION, modelContext: context });
  await adapter.discover();

  const execution = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(execution.status, "ok");
  if (execution.status !== "ok") throw new Error("unreachable");
  assert.equal(context.calls[1].input, '{"query":"lamp"}', "input crosses as a JSON string");
  assert.equal(execution.evidence.trust, "untrusted");
  assert.equal(execution.evidence.origin, COMPANION);
  assert.equal(execution.evidence.excerpt, '{"results":[{"id":"lumen-lamp"}]}');
  assert.equal(
    execution.evidence.digest,
    await digestSha256('{"results":[{"id":"lumen-lamp"}]}'),
  );
});

test("adapter rejects out-of-envelope input before any cross-origin call", async () => {
  const context = fakeContext({});
  const adapter = createCompanionToolAdapter({ origin: COMPANION, modelContext: context });
  await adapter.discover();
  const callsAfterDiscovery = context.calls.length;

  const execution = await adapter.execute("search_catalog", { query: "x".repeat(1_000) });
  assert.equal(execution.status, "rejected");
  assert.equal(context.calls.length, callsAfterDiscovery, "nothing was sent to the companion");
});

test("adapter reports navigation when the API returns null instead of inventing a result", async () => {
  const adapter = createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: fakeContext({ result: null }),
  });
  await adapter.discover();
  const execution = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(execution.status, "navigated");
});

test("adapter surfaces a thrown companion error without fabricating evidence", async () => {
  const adapter = createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: fakeContext({ fail: new Error("companion refused") }),
  });
  await adapter.discover();
  const execution = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(execution.status, "error");
  if (execution.status !== "error") throw new Error("unreachable");
  assert.match(execution.reason, /companion refused/);
});

test("adapter aborts a companion tool that exceeds its timeout", async () => {
  const adapter = createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: fakeContext({ hang: true }),
    timeoutMs: 20,
  });
  await adapter.discover();
  const execution = await adapter.execute("search_catalog", { query: "lamp" });
  assert.equal(execution.status, "error");
  if (execution.status !== "error") throw new Error("unreachable");
  assert.match(execution.reason, /did not respond within 20ms and was aborted/);
});

test("adapter reports a discovery error rather than a tool list when getTools misbehaves", async () => {
  const notAList = await createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: { async getTools() { return "nope"; }, async executeTool() { return null; } },
  }).discover();
  assert.equal(notAList.status, "error");

  const throws = await createCompanionToolAdapter({
    origin: COMPANION,
    modelContext: {
      async getTools() { throw new Error("permission denied"); },
      async executeTool() { return null; },
    },
  }).discover();
  assert.equal(throws.status, "error");
  if (throws.status !== "error") throw new Error("unreachable");
  assert.match(throws.reason, /permission denied/);
});

/* -------------------------------------------------------------------------- */
/* Durable provenance append                                                  */
/* -------------------------------------------------------------------------- */

class Conflict extends Error {
  readonly status = 409;
}

async function sampleEvent() {
  return toCompanionEvidenceEvent(
    await wrapCompanionEvidence({
      origin: COMPANION,
      toolName: "update_cart",
      readOnly: false,
      input: { itemId: "lumen-lamp", quantity: 2 },
      result: '{"items":[{"id":"lumen-lamp","quantity":2}],"simulated":true}',
      capturedAt: "2026-08-26T12:00:00.000Z",
    }),
  );
}

/** Records what was appended so the trust and sequence contract can be asserted. */
function fakeMissionClient(options: {
  lastEventSequence?: number;
  missing?: boolean;
  failures?: Error[];
}): CompanionEvidenceClient & { appended: Record<string, unknown>[]; readonly reads: number } {
  const failures = [...(options.failures ?? [])];
  const appended: Record<string, unknown>[] = [];
  let reads = 0;
  let sequence = options.lastEventSequence ?? 7;
  return {
    appended,
    get reads() {
      return reads;
    },
    async getMission() {
      reads += 1;
      if (options.missing) return null;
      return { mission: { lastEventSequence: sequence } };
    },
    async appendEvent(_missionId, body) {
      const failure = failures.shift();
      if (failure) {
        // A competing writer advances the log between attempts.
        sequence += 1;
        throw failure;
      }
      appended.push(body as unknown as Record<string, unknown>);
      return { id: `event-${appended.length}`, sequence: body.expectedSequence + 1 };
    },
  };
}

const describeFailure = (error: unknown) => (error instanceof Error ? error.message : "unknown");
const isSequenceConflict = (error: unknown) => error instanceof Conflict;
const newCorrelationId = () => "00000000-0000-4000-8000-000000000009";

test("evidence append commits as untrusted at the authoritative sequence", async () => {
  const client = fakeMissionClient({ lastEventSequence: 7 });
  const event = await sampleEvent();
  const receipt = await appendCompanionEvidence({
    client,
    missionId: "mission-1",
    event,
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });

  assert.deepEqual(receipt, { persisted: true, eventId: "event-1", sequence: 8 });
  assert.equal(client.appended.length, 1);
  const body = client.appended[0];
  assert.equal(body.type, "evidence.recorded");
  assert.equal(body.trust, "untrusted", "captured external content is never appended as trusted");
  assert.equal(body.expectedSequence, 7, "uses the server's committed sequence, not a guess");
  assert.equal(body.idempotencyKey, companionEvidenceIdempotencyKey(event.payload));
});

test("evidence append never claims persistence without a mission", async () => {
  const client = fakeMissionClient({});
  const receipt = await appendCompanionEvidence({
    client,
    missionId: null,
    event: await sampleEvent(),
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });
  assert.equal(receipt.persisted, false);
  assert.match(receipt.reason ?? "", /no mission yet/);
  assert.equal(client.appended.length, 0);
});

test("evidence append reports an unreadable mission instead of inventing a record", async () => {
  const receipt = await appendCompanionEvidence({
    client: fakeMissionClient({ missing: true }),
    missionId: "mission-1",
    event: await sampleEvent(),
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });
  assert.equal(receipt.persisted, false);
  assert.match(receipt.reason ?? "", /no longer readable/);
});

test("evidence append retries only a sequence race, reusing one idempotency key", async () => {
  const client = fakeMissionClient({ lastEventSequence: 7, failures: [new Conflict("raced")] });
  const event = await sampleEvent();
  const receipt = await appendCompanionEvidence({
    client,
    missionId: "mission-1",
    event,
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });

  assert.equal(receipt.persisted, true);
  assert.equal(client.reads, 2, "re-reads the sequence before retrying");
  assert.equal(client.appended[0].expectedSequence, 8, "retries against the advanced sequence");
  assert.equal(
    client.appended[0].idempotencyKey,
    companionEvidenceIdempotencyKey(event.payload),
    "one observation keeps one key, so a retry cannot double-record it",
  );
});

test("evidence append gives up after the retry budget and stays honest", async () => {
  const failures = Array.from(
    { length: COMPANION_EVIDENCE_MAX_RETRIES + 1 },
    () => new Conflict("still racing"),
  );
  const client = fakeMissionClient({ failures });
  const receipt = await appendCompanionEvidence({
    client,
    missionId: "mission-1",
    event: await sampleEvent(),
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });
  assert.equal(receipt.persisted, false);
  assert.equal(receipt.reason, "still racing");
  assert.equal(client.appended.length, 0, "nothing was committed");
});

test("evidence append does not retry a non-conflict failure", async () => {
  const client = fakeMissionClient({ failures: [new Error("session expired")] });
  const receipt = await appendCompanionEvidence({
    client,
    missionId: "mission-1",
    event: await sampleEvent(),
    describeFailure,
    isSequenceConflict,
    newCorrelationId,
  });
  assert.equal(receipt.persisted, false);
  assert.equal(receipt.reason, "session expired");
  assert.equal(client.reads, 1, "a final failure is not retried");
});
