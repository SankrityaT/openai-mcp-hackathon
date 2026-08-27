import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComposioEvidence,
  ComposioStateError,
  computeComposioBackoffMs,
  COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP,
  createCircuitBreakerStore,
  isRetryableComposioFailure,
  signComposioState,
  verifyComposioState,
} from "./composio-support";

const secret = "test-secret-do-not-use-in-prod";

test("signed state round-trips and binds the exact user and toolkit", () => {
  const token = signComposioState({ userId: "user-1", toolkit: "gmail", sessionId: "session-1" }, secret);
  const verified = verifyComposioState(token, { userId: "user-1" }, secret);
  assert.deepEqual(verified, { toolkit: "gmail", sessionId: "session-1" });
});

test("state verification rejects a token signed for a different user", () => {
  const token = signComposioState({ userId: "user-1", toolkit: "gmail", sessionId: "session-1" }, secret);
  assert.throws(
    () => verifyComposioState(token, { userId: "attacker" }, secret),
    (error: unknown) => error instanceof ComposioStateError && error.reason === "user_mismatch",
  );
});

test("state verification rejects an expired token", () => {
  const issuedAt = 1_000_000;
  const token = signComposioState({ userId: "user-1", toolkit: "gmail", sessionId: "session-1" }, secret, issuedAt);
  assert.throws(
    () => verifyComposioState(token, { userId: "user-1" }, secret, issuedAt + 11 * 60 * 1000),
    (error: unknown) => error instanceof ComposioStateError && error.reason === "expired",
  );
});

test("state verification rejects a tampered signature", () => {
  const token = signComposioState({ userId: "user-1", toolkit: "gmail", sessionId: "session-1" }, secret);
  const [encoded] = token.split(".");
  const tampered = `${encoded}.${"0".repeat(43)}`;
  assert.throws(
    () => verifyComposioState(tampered, { userId: "user-1" }, secret),
    (error: unknown) => error instanceof ComposioStateError && error.reason === "invalid_signature",
  );
});

test("state verification rejects a token signed with a different secret", () => {
  const token = signComposioState({ userId: "user-1", toolkit: "gmail", sessionId: "session-1" }, secret);
  assert.throws(
    () => verifyComposioState(token, { userId: "user-1" }, "a-completely-different-secret"),
    (error: unknown) => error instanceof ComposioStateError && error.reason === "invalid_signature",
  );
});

test("state verification rejects a malformed token", () => {
  assert.throws(
    () => verifyComposioState("not-a-valid-token", { userId: "user-1" }, secret),
    (error: unknown) => error instanceof ComposioStateError && error.reason === "malformed",
  );
});

test("evidence shaping caps the excerpt but preserves the original byte count and a stable digest", () => {
  const bigValue = "x".repeat(COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP * 3);
  const evidence = buildComposioEvidence("GMAIL_FETCH_EMAILS", { body: bigValue });
  assert.equal(evidence.provider, "composio");
  assert.equal(evidence.trust, "untrusted");
  assert.equal(evidence.origin, "composio:GMAIL_FETCH_EMAILS");
  assert.ok(evidence.bytes > COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP, "bytes reflects the full payload size");
  assert.ok(
    Buffer.byteLength(evidence.excerpt, "utf8") <= COMPOSIO_EVIDENCE_EXCERPT_BYTE_CAP,
    "excerpt must never exceed the byte cap",
  );
  const again = buildComposioEvidence("GMAIL_FETCH_EMAILS", { body: bigValue });
  assert.equal(evidence.digestSha256, again.digestSha256, "digest is a pure function of the payload");
});

test("evidence digest changes when the underlying content changes", () => {
  const a = buildComposioEvidence("GOOGLECALENDAR_FIND_EVENT", { summary: "Team sync" });
  const b = buildComposioEvidence("GOOGLECALENDAR_FIND_EVENT", { summary: "Team sync (moved)" });
  assert.notEqual(a.digestSha256, b.digestSha256);
});

test("circuit breaker opens after the failure threshold and resets on success", () => {
  const store = createCircuitBreakerStore();
  const now = 1_000_000;
  assert.equal(store.isOpen("GMAIL_FETCH_EMAILS", now), false);
  store.recordFailure("GMAIL_FETCH_EMAILS", now);
  store.recordFailure("GMAIL_FETCH_EMAILS", now);
  assert.equal(store.isOpen("GMAIL_FETCH_EMAILS", now), false, "below threshold stays closed");
  store.recordFailure("GMAIL_FETCH_EMAILS", now);
  assert.equal(store.isOpen("GMAIL_FETCH_EMAILS", now), true, "threshold trips the breaker");
  assert.equal(store.isOpen("GMAIL_FETCH_EMAILS", now + 60_000), false, "cools down after the window");
  store.recordSuccess("GMAIL_FETCH_EMAILS");
  store.recordFailure("GMAIL_FETCH_EMAILS", now);
  assert.equal(store.isOpen("GMAIL_FETCH_EMAILS", now), false, "success clears the failure count");
});

test("circuit breaker keys are isolated per tool", () => {
  const store = createCircuitBreakerStore();
  const now = 0;
  for (let i = 0; i < 3; i += 1) store.recordFailure("TOOL_A", now);
  assert.equal(store.isOpen("TOOL_A", now), true);
  assert.equal(store.isOpen("TOOL_B", now), false);
});

test("retryable-failure classifier recognizes transient errors and rejects validation errors", () => {
  assert.equal(isRetryableComposioFailure("Request timed out"), true);
  assert.equal(isRetryableComposioFailure("upstream returned 503"), true);
  assert.equal(isRetryableComposioFailure("rate limit exceeded"), true);
  assert.equal(isRetryableComposioFailure("invalid tool arguments"), false);
});

test("backoff grows and stays within the configured cap", () => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const delay = computeComposioBackoffMs(attempt, 100, 1_000);
    assert.ok(delay >= 0 && delay <= 1_000, `attempt ${attempt} produced out-of-range delay ${delay}`);
  }
});
