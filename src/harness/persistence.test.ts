import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPersistence } from "./persistence/in-memory-persistence";

const ACTOR = { kind: "system" as const, id: "test" };

test("appendEvent assigns sequential sequence numbers and rejects a stale writer", async () => {
  const persistence = new InMemoryPersistence();
  const first = await persistence.appendEvent({
    missionId: "mission-1",
    expectedSequence: 0,
    type: "mission.created",
    actor: ACTOR,
    correlationId: "correlation-1",
    payload: {},
    trust: "derived",
  });
  assert.equal(first.sequence, 1);

  const second = await persistence.appendEvent({
    missionId: "mission-1",
    expectedSequence: 1,
    type: "mandate.proposed",
    actor: ACTOR,
    correlationId: "correlation-1",
    payload: {},
    trust: "derived",
  });
  assert.equal(second.sequence, 2);

  await assert.rejects(() =>
    persistence.appendEvent({
      missionId: "mission-1",
      expectedSequence: 1, // stale: sequence 2 is already committed
      type: "node.planned",
      actor: ACTOR,
      correlationId: "correlation-1",
      payload: {},
      trust: "derived",
    }),
  );
});

test("reserveIdempotency reports new once, reserved for a concurrent duplicate, and replays after completion", async () => {
  const persistence = new InMemoryPersistence();
  const reservation1 = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    capabilityId: "internal.echo_research",
    action: "internal.echo_research",
    key: "idem_1",
    requestFingerprint: "fingerprint_1",
  });
  assert.equal(reservation1.state, "new");

  const reservation2 = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    capabilityId: "internal.echo_research",
    action: "internal.echo_research",
    key: "idem_1",
    requestFingerprint: "fingerprint_1",
  });
  assert.equal(reservation2.state, "reserved", "a concurrent duplicate must not silently re-execute");

  await persistence.completeIdempotency({
    tenantId: "tenant-1",
    key: "idem_1",
    outcome: "succeeded",
    result: { finding: "cached" },
  });

  const reservation3 = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    capabilityId: "internal.echo_research",
    action: "internal.echo_research",
    key: "idem_1",
    requestFingerprint: "fingerprint_1",
  });
  assert.equal(reservation3.state, "succeeded");
  assert.deepEqual(reservation3.storedResult, { finding: "cached" });
});

test("reserveIdempotency reports a conflict for the same key with a different request fingerprint", async () => {
  const persistence = new InMemoryPersistence();
  await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    capabilityId: "internal.echo_research",
    action: "internal.echo_research",
    key: "idem_shared",
    requestFingerprint: "fingerprint_a",
  });
  const conflict = await persistence.reserveIdempotency({
    tenantId: "tenant-1",
    missionId: "mission-1",
    capabilityId: "internal.echo_research",
    action: "internal.echo_research",
    key: "idem_shared",
    requestFingerprint: "fingerprint_b",
  });
  assert.equal(conflict.state, "conflict");
});

test("requestApproval appends exactly one approval.requested event and records a pending approval", async () => {
  const persistence = new InMemoryPersistence();
  const approval = await persistence.requestApproval({
    missionId: "mission-1",
    expectedSequence: 0,
    category: "read",
    actionFingerprint: "fingerprint_1",
    recommendation: "Execute the fixture capability",
    alternatives: [],
    evidence: [],
    consequence: "None",
    mandateVersion: 1,
    actor: ACTOR,
    correlationId: "correlation-1",
    idempotencyKey: "approval-idem-1",
  });
  assert.equal(approval.status, "pending");
  assert.equal(persistence.events.length, 1);
  assert.equal(persistence.events[0].type, "approval.requested");
  assert.equal(persistence.approvals.length, 1);
});

test("recordUsage accumulates quantity and cost per subject/metric", async () => {
  const persistence = new InMemoryPersistence();
  const first = await persistence.recordUsage({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    subjectKind: "node",
    subjectId: "node-1",
    metric: "tool_calls",
    quantity: 1,
    costMicrounits: 0,
    limitQuantity: 10,
    limitCostMicrounits: 100,
    windowStart: new Date(0).toISOString(),
    windowEnd: new Date(1).toISOString(),
    idempotencyKey: "usage-1",
    correlationId: "correlation-1",
  });
  assert.equal(first.totalQuantity, 1);
  const second = await persistence.recordUsage({
    tenantId: "tenant-1",
    missionId: "mission-1",
    nodeId: "node-1",
    subjectKind: "node",
    subjectId: "node-1",
    metric: "tool_calls",
    quantity: 1,
    costMicrounits: 0,
    limitQuantity: 10,
    limitCostMicrounits: 100,
    windowStart: new Date(0).toISOString(),
    windowEnd: new Date(1).toISOString(),
    idempotencyKey: "usage-2",
    correlationId: "correlation-1",
  });
  assert.equal(second.totalQuantity, 2);
});
