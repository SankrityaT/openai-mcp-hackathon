import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  constantTimeHexEqual,
  createOpaqueToken,
  decodeSignedCookie,
  encodeSignedCookie,
  hashIpSignal,
  isSha256Hex,
  matchesJudgeCode,
  sha256Hex,
  signValue,
  verifySignedValue,
} from "./credentials";

const code = "cardea-judge-2026";
const codeHash = createHash("sha256").update(code, "utf8").digest("hex");

test("a judge code matches only its own hash", () => {
  assert.equal(sha256Hex(code), codeHash);
  assert.equal(matchesJudgeCode(code, codeHash), true);
  assert.equal(matchesJudgeCode(`${code} `, codeHash), false);
  assert.equal(matchesJudgeCode("cardea-judge-2027", codeHash), false);
});

test("a judge comparison fails closed on missing or malformed configuration", () => {
  assert.equal(matchesJudgeCode(code, undefined), false);
  assert.equal(matchesJudgeCode(code, ""), false);
  assert.equal(matchesJudgeCode(code, "not-a-hash"), false);
  assert.equal(matchesJudgeCode(code, codeHash.slice(0, 63)), false);
  assert.equal(matchesJudgeCode("", codeHash), false);
  assert.equal(matchesJudgeCode("x".repeat(201), codeHash), false);
  assert.equal(matchesJudgeCode(12345, codeHash), false);
});

test("hash comparison is case-insensitive and never throws on bad input", () => {
  assert.equal(constantTimeHexEqual(codeHash.toUpperCase(), codeHash), true);
  assert.equal(constantTimeHexEqual(codeHash, `${codeHash}00`), false);
  assert.equal(constantTimeHexEqual(null, codeHash), false);
  assert.equal(constantTimeHexEqual(codeHash, { hash: codeHash }), false);
});

test("only well-formed digests are accepted as digests", () => {
  assert.equal(isSha256Hex(codeHash), true);
  assert.equal(isSha256Hex(codeHash.toUpperCase()), false);
  assert.equal(isSha256Hex("zz"), false);
});

test("guest tokens are high entropy and distinct", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("a signed cookie round-trips and rejects tampering", () => {
  const secret = "a-sufficiently-long-secret";
  const token = createOpaqueToken();
  const cookie = encodeSignedCookie(token, secret);

  assert.equal(cookie, `${token}.${signValue(secret, token)}`);
  assert.equal(decodeSignedCookie(cookie, secret), token);
  assert.equal(verifySignedValue(secret, token, signValue(secret, token)), true);

  assert.equal(decodeSignedCookie(`${token}.${"0".repeat(64)}`, secret), null);
  assert.equal(decodeSignedCookie(token, secret), null, "unsigned cookies are refused");
  assert.equal(decodeSignedCookie(cookie, "another-sufficiently-long-secret"), null);
  assert.equal(decodeSignedCookie(undefined, secret), null);
});

test("without a configured secret the bare cookie value is returned", () => {
  const token = createOpaqueToken();
  assert.equal(encodeSignedCookie(token, null), token);
  assert.equal(decodeSignedCookie(token, null), token);
});

test("an ip abuse signal is hashed with a salt and never echoed", () => {
  const hashed = hashIpSignal("203.0.113.7", "salt");
  assert.ok(hashed);
  assert.match(hashed, /^[a-f0-9]{64}$/);
  assert.notEqual(hashed, hashIpSignal("203.0.113.7", "other-salt"));
  assert.equal(hashIpSignal("  ", "salt"), null);
  assert.equal(hashIpSignal(undefined, "salt"), null);
});
