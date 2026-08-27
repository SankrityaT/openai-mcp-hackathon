import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_GRACE_MS, SessionLedger, validateNodeId } from "./ledger";

test("one Cloudflare session per node id, reused on reconnect", () => {
  const ledger = new SessionLedger();
  const first = ledger.claim("node-a", 0);
  assert.ok(first.ok && first.reused === false);
  ledger.bind("node-a", "SESSION-A", "wss://example.test/a");

  const second = ledger.claim("node-a", 10);
  assert.ok(second.ok && second.reused === true);
  assert.equal(second.entry.sessionId, "SESSION-A");
  assert.equal(second.entry.attached, 2);
  assert.equal(ledger.size(), 1);
});

test("the concurrency cap refuses a third distinct node", () => {
  const ledger = new SessionLedger();
  assert.ok(ledger.claim("a", 0).ok);
  assert.ok(ledger.claim("b", 0).ok);
  const third = ledger.claim("c", 0);
  assert.deepEqual(third, { ok: false, reason: "at_capacity" });
  assert.equal(ledger.size(), 2);
});

test("a reconnect to an existing node is admitted even at capacity", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  const again = ledger.claim("a", 5);
  assert.ok(again.ok && again.reused);
});

test("a session survives its grace period so another tab can reattach", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.bind("a", "SESSION-A", "wss://example.test/a");
  ledger.release("a", 1_000);

  assert.deepEqual(ledger.reap(1_000 + IDLE_GRACE_MS - 1), []);
  assert.equal(ledger.size(), 1);

  const reaped = ledger.reap(1_000 + IDLE_GRACE_MS);
  assert.equal(reaped.length, 1);
  assert.equal(reaped[0].sessionId, "SESSION-A");
  assert.equal(ledger.size(), 0);
  // Reaping removes the entry, so the caller can never double close it.
  assert.deepEqual(ledger.reap(9_999_999), []);
});

test("reattaching inside the grace period cancels the reap", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.release("a", 1_000);
  const again = ledger.claim("a", 1_500);
  assert.ok(again.ok && again.entry.idleSince === null);
  assert.deepEqual(ledger.reap(1_000 + IDLE_GRACE_MS + 1), []);
});

test("a second socket detaching does not start the clock while one remains", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("a", 0);
  ledger.release("a", 100);
  assert.equal(ledger.get("a")?.attached, 1);
  assert.equal(ledger.get("a")?.idleSince, null);
  assert.deepEqual(ledger.reap(9_999_999), []);
});

test("abandon frees capacity for a reservation that never became a session", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  ledger.abandon("b");
  assert.ok(ledger.claim("c", 0).ok);
});

test("take removes the entry once so stop is idempotent upstream", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.bind("a", "SESSION-A", "wss://example.test/a");
  assert.equal(ledger.take("a")?.sessionId, "SESSION-A");
  assert.equal(ledger.take("a"), null);
});

test("node ids from the client are bounded and character restricted", () => {
  assert.equal(validateNodeId("node_01:beta-1.2"), "node_01:beta-1.2");
  assert.equal(validateNodeId("  spaced  "), "spaced");
  assert.equal(validateNodeId("../etc/passwd"), null);
  assert.equal(validateNodeId("node id"), null);
  assert.equal(validateNodeId(""), null);
  assert.equal(validateNodeId("x".repeat(129)), null);
  assert.equal(validateNodeId(undefined), null);
});
