import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "./capability-registry";
import type { CapabilityAdapter } from "./contracts";

const adapter: CapabilityAdapter = {
  provider: "fixture",
  async discover() {
    return [{
      id: "fixture.read",
      provider: "fixture",
      name: "read_fixture",
      description: "Read a fixture",
      inputSchema: {},
      risk: { level: "low", categories: ["read"] },
      trust: { level: "derived" },
      readOnly: true,
    }];
  },
  async execute(request) {
    return {
      executionId: request.idempotencyKey,
      output: { ok: true },
      summary: "Fixture read",
      provenance: "fixture",
      trust: "derived",
    };
  },
};

test("discovers and executes through the owning adapter", async () => {
  const registry = new CapabilityRegistry();
  registry.register(adapter);
  assert.equal((await registry.discover()).length, 1);
  const result = await registry.execute({
    capabilityId: "fixture.read",
    missionId: "mission",
    input: {},
    correlationId: "correlation",
    idempotencyKey: "operation",
  });
  assert.equal(result.summary, "Fixture read");
});
