import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_GRACE_MS, MAX_CONCURRENT_TABS, SessionLedger, validateNodeId } from "./ledger";

test("one tab per node id, reused on reconnect", () => {
  const ledger = new SessionLedger();
  const first = ledger.claim("node-a", 0);
  assert.ok(first.ok && first.reused === false);
  ledger.bindTarget("node-a", "TARGET-A");

  const second = ledger.claim("node-a", 10);
  assert.ok(second.ok && second.reused === true);
  assert.equal(second.entry.targetId, "TARGET-A");
  assert.equal(second.entry.attached, 2);
  assert.equal(ledger.size(), 1);
});

test("the tab cap refuses one more distinct node", () => {
  const ledger = new SessionLedger();
  for (let i = 0; i < MAX_CONCURRENT_TABS; i += 1) {
    assert.ok(ledger.claim(`node-${i}`, 0).ok);
  }
  const over = ledger.claim("one-more", 0);
  assert.deepEqual(over, { ok: false, reason: "at_capacity" });
  assert.equal(ledger.size(), MAX_CONCURRENT_TABS);
});

test("a reconnect to an existing node is admitted even at capacity", () => {
  const ledger = new SessionLedger(2);
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  const again = ledger.claim("a", 5);
  assert.ok(again.ok && again.reused);
});

test("the shared browser binds once and is visible to every claim", () => {
  const ledger = new SessionLedger();
  assert.equal(ledger.getBrowser(), null);
  ledger.claim("a", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  assert.deepEqual(ledger.getBrowser(), {
    sessionId: "SESSION",
    webSocketDebuggerUrl: "wss://example.test/shared",
  });
});

test("invalidating the browser forgets every tab with it", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  const dead = ledger.invalidateBrowser();
  assert.equal(dead?.sessionId, "SESSION");
  assert.equal(ledger.size(), 0);
  assert.equal(ledger.getBrowser(), null);
  // Idempotent: a second invalidation has nothing left to hand back.
  assert.equal(ledger.invalidateBrowser(), null);
});

test("a tab survives its grace period so another socket can reattach", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  ledger.bindTarget("a", "TARGET-A");
  ledger.release("a", 1_000);

  assert.deepEqual(ledger.reap(1_000 + IDLE_GRACE_MS - 1), { tabs: [], browser: null });
  assert.equal(ledger.size(), 2);

  const reaped = ledger.reap(1_000 + IDLE_GRACE_MS);
  assert.equal(reaped.tabs.length, 1);
  assert.equal(reaped.tabs[0].targetId, "TARGET-A");
  // Another tab is still open, so the browser survives the sweep.
  assert.equal(reaped.browser, null);
  assert.equal(ledger.size(), 1);
  // Reaping removes the entry, so the caller can never double close it.
  ledger.release("b", 0);
  assert.equal(ledger.reap(1_000 + IDLE_GRACE_MS).tabs.length, 0);
});

test("reaping the last tab hands back the browser instead", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  ledger.bindTarget("a", "TARGET-A");
  ledger.release("a", 1_000);

  const reaped = ledger.reap(1_000 + IDLE_GRACE_MS);
  assert.deepEqual(reaped.tabs, []);
  assert.equal(reaped.browser?.sessionId, "SESSION");
  assert.equal(ledger.getBrowser(), null);
  assert.equal(ledger.size(), 0);
});

test("reattaching inside the grace period cancels the reap", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.release("a", 1_000);
  const again = ledger.claim("a", 1_500);
  assert.ok(again.ok && again.entry.idleSince === null);
  assert.deepEqual(ledger.reap(1_000 + IDLE_GRACE_MS + 1), { tabs: [], browser: null });
});

test("a second socket detaching does not start the clock while one remains", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("a", 0);
  ledger.release("a", 100);
  assert.equal(ledger.get("a")?.attached, 1);
  assert.equal(ledger.get("a")?.idleSince, null);
  assert.deepEqual(ledger.reap(9_999_999), { tabs: [], browser: null });
});

test("abandon frees capacity for a reservation that never became a tab", () => {
  const ledger = new SessionLedger(2);
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  ledger.abandon("b");
  assert.ok(ledger.claim("c", 0).ok);
});

test("take removes the entry once so stop is idempotent upstream", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.claim("b", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  ledger.bindTarget("a", "TARGET-A");

  const taken = ledger.take("a");
  assert.equal(taken?.entry.targetId, "TARGET-A");
  // Another tab remains, so the caller closes only this one.
  assert.equal(taken?.browser, null);
  assert.equal(ledger.take("a"), null);
});

test("taking the last tab hands back the browser to close", () => {
  const ledger = new SessionLedger();
  ledger.claim("a", 0);
  ledger.bindBrowser("SESSION", "wss://example.test/shared");
  const taken = ledger.take("a");
  assert.equal(taken?.browser?.sessionId, "SESSION");
  assert.equal(ledger.getBrowser(), null);
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
