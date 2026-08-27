import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_FIXTURE_CAPABILITY_ID,
  InternalFixtureAdapter,
  internalFixtureAdapter,
} from "./adapters/internal-fixture";

// The determinism tests below exercise the offline fixture path, so a model
// key leaking in from the invoking shell must not flip them onto the live
// model path.
const savedKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
test.after(() => {
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

test("discovers exactly one read-only, deterministic, provider-'internal' capability", async () => {
  const capabilities = await internalFixtureAdapter.discover();
  assert.equal(capabilities.length, 1);
  const [capability] = capabilities;
  assert.equal(capability.id, INTERNAL_FIXTURE_CAPABILITY_ID);
  assert.equal(capability.provider, "internal");
  assert.equal(capability.readOnly, true);
  assert.equal(capability.risk.level, "low");
  // The capability descriptor itself is Cardea's own deterministic function
  // ("derived"), not external content — see the design note in
  // adapters/internal-fixture.ts for why this must not be "untrusted".
  assert.equal(capability.trust.level, "derived");
});

test("execute is deterministic, bounded, and labels its evidence untrusted", async () => {
  const result = await internalFixtureAdapter.execute({
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    missionId: "mission-1",
    input: { topic: "relocation budget" },
    correlationId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "idem_test",
  });
  assert.equal(result.trust, "untrusted");
  assert.ok(result.provenance.length > 0);
  assert.ok(JSON.stringify(result.output).length < 4_200);

  const again = await internalFixtureAdapter.execute({
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    missionId: "mission-1",
    input: { topic: "relocation budget" },
    correlationId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "idem_test",
  });
  assert.deepEqual(result.output, again.output, "identical input must produce identical output");
});

test("execute rejects a mismatched capability id", async () => {
  await assert.rejects(() =>
    internalFixtureAdapter.execute({
      capabilityId: "not.the.fixture",
      missionId: "mission-1",
      input: {},
      correlationId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: "idem_test",
    }),
  );
});

test("a supplied generator does the real work and shapes summary from its first line", async () => {
  const adapter = new InternalFixtureAdapter(async (topic) => `Party checklist for ${topic}\n- venue\n- cake`);
  const result = await adapter.execute({
    capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
    missionId: "mission-1",
    input: { topic: "grandma's birthday" },
    correlationId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "idem_test",
  });
  assert.equal(result.trust, "untrusted");
  assert.equal(result.provenance, "internal://cardea/worker/model");
  assert.equal(result.summary, "Party checklist for grandma's birthday");
  assert.match(String((result.output as Record<string, unknown>).finding), /- venue/);
});

test("a failing generator propagates instead of degrading to a placeholder", async () => {
  const adapter = new InternalFixtureAdapter(async () => {
    throw new Error("model unavailable");
  });
  await assert.rejects(
    () =>
      adapter.execute({
        capabilityId: INTERNAL_FIXTURE_CAPABILITY_ID,
        missionId: "mission-1",
        input: { topic: "anything" },
        correlationId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "idem_test",
      }),
    /model unavailable/,
  );
});
