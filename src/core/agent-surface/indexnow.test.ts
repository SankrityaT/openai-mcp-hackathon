import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INDEXNOW_KEY_PATH,
  buildIndexNowSubmission,
  describeIndexNowStatus,
  isValidIndexNowKey,
} from "./indexnow";

const ORIGIN = "https://cardea-two.vercel.app";
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("key validation follows the IndexNow character and length rules", () => {
  assert.ok(isValidIndexNowKey(KEY));
  assert.ok(isValidIndexNowKey("abcd1234"), "8 characters is the minimum");
  assert.ok(isValidIndexNowKey("A-B-c-1".padEnd(128, "x")), "dashes and mixed case are allowed");
  assert.ok(!isValidIndexNowKey("short7"), "under 8 characters");
  assert.ok(!isValidIndexNowKey("x".repeat(129)), "over 128 characters");
  assert.ok(!isValidIndexNowKey("has spaces here"), "spaces are not allowed");
  assert.ok(!isValidIndexNowKey("has_underscore123"), "underscores are not allowed");
  assert.ok(!isValidIndexNowKey(""), "empty is not a key");
});

test("a submission names the host, the key, and its location", () => {
  const submission = buildIndexNowSubmission(ORIGIN, KEY, ["/", "/privacy"]);
  assert.equal(submission.host, "cardea-two.vercel.app");
  assert.equal(submission.key, KEY);
  assert.equal(submission.keyLocation, `${ORIGIN}${INDEXNOW_KEY_PATH}`);
});

test("relative paths are resolved to absolute URLs on the submitting host", () => {
  const submission = buildIndexNowSubmission(ORIGIN, KEY, ["/", "/privacy", "/terms"]);
  assert.deepEqual(submission.urlList, [
    `${ORIGIN}/`,
    `${ORIGIN}/privacy`,
    `${ORIGIN}/terms`,
  ]);
});

test("a URL on another host is refused locally instead of earning a remote 422", () => {
  assert.throws(
    () => buildIndexNowSubmission(ORIGIN, KEY, ["https://example.com/evil"]),
    /not on cardea-two\.vercel\.app/,
  );
});

test("an invalid key fails at build time, not as an opaque 403", () => {
  assert.throws(() => buildIndexNowSubmission(ORIGIN, "bad key", ["/"]), /8 to 128 characters/);
});

test("the submission follows the origin it is given", () => {
  const preview = "https://cardea-preview.example.com";
  const submission = buildIndexNowSubmission(preview, KEY, ["/"]);
  assert.equal(submission.host, "cardea-preview.example.com");
  assert.equal(submission.urlList[0], `${preview}/`);
  assert.ok(submission.keyLocation.startsWith(preview));
});

test("both success statuses are reported as success, including the pending one", () => {
  assert.equal(describeIndexNowStatus(200).ok, true);
  const accepted = describeIndexNowStatus(202);
  assert.equal(accepted.ok, true);
  assert.match(accepted.meaning, /pending/i, "202 must not be reported as fully confirmed");
});

test("each documented failure status explains itself", () => {
  for (const status of [400, 403, 422, 429]) {
    const described = describeIndexNowStatus(status);
    assert.equal(described.ok, false, `${status} must not read as success`);
    assert.ok(described.meaning.length > 10, `${status} needs a real explanation`);
  }
  assert.match(describeIndexNowStatus(403).meaning, /key file/i);
  assert.match(describeIndexNowStatus(429).meaning, /rate limited/i);
});

test("an unknown status is a failure, not a silent success", () => {
  const described = describeIndexNowStatus(500);
  assert.equal(described.ok, false);
  assert.match(described.meaning, /500/);
});
