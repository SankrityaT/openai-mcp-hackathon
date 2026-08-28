import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOT_ACCEPTABLE,
  negotiateMediaType,
  parseAcceptHeader,
  qualityFor,
} from "./negotiation";

const HTML = "text/html";
const MARKDOWN = "text/markdown";
/** Server preference order: an ordinary browser must keep getting HTML. */
const OFFERED = [HTML, MARKDOWN] as const;

const negotiate = (header: string | null) => negotiateMediaType(header, OFFERED);

test("a request with no preference gets the server's first choice, never a 406", () => {
  assert.equal(negotiate(null), HTML);
  assert.equal(negotiate(""), HTML);
  assert.equal(negotiate("   "), HTML);
});

test("an ordinary browser still gets HTML", () => {
  assert.equal(
    negotiate("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
    HTML,
  );
});

test("curl and crawler wildcards get HTML", () => {
  assert.equal(negotiate("*/*"), HTML);
  assert.equal(negotiate("text/*"), HTML);
  // Googlebot's advertised Accept.
  assert.equal(negotiate("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), HTML);
});

test("an agent asking for markdown gets markdown", () => {
  assert.equal(negotiate(MARKDOWN), MARKDOWN);
  assert.equal(negotiate("text/markdown, text/html;q=0.9"), MARKDOWN);
  assert.equal(negotiate("text/markdown;q=1.0"), MARKDOWN);
});

test("q-values decide, not header order", () => {
  // Markdown listed second but weighted higher.
  assert.equal(negotiate("text/html;q=0.5, text/markdown;q=0.9"), MARKDOWN);
  // HTML listed second but weighted higher.
  assert.equal(negotiate("text/markdown;q=0.2, text/html;q=0.8"), HTML);
});

test("equal weights fall back to server preference", () => {
  assert.equal(negotiate("text/markdown, text/html"), HTML);
  assert.equal(negotiate("text/html;q=0.7, text/markdown;q=0.7"), HTML);
});

test("a more specific range overrides a broad low-weight wildcard", () => {
  // RFC 9110 §12.5.1: the most specific matching range supplies the weight,
  // so this is a markdown request despite the wildcard being listed first.
  assert.equal(negotiate("*/*;q=0.1, text/markdown;q=0.9"), MARKDOWN);
  assert.equal(negotiate("*/*;q=0.1, text/markdown"), MARKDOWN);
  // And the same rule the other way round.
  assert.equal(negotiate("*/*;q=0.9, text/markdown;q=0.1"), HTML);
});

test("q=0 excludes a type explicitly", () => {
  assert.equal(negotiate("text/html;q=0, text/markdown"), MARKDOWN);
  assert.equal(negotiate("text/markdown;q=0, text/html"), HTML);
  // Everything on offer excluded is a 406, not a silent fallback.
  assert.equal(negotiate("text/html;q=0, text/markdown;q=0"), NOT_ACCEPTABLE);
  assert.equal(negotiate("*/*;q=0"), NOT_ACCEPTABLE);
});

test("a client that accepts nothing we produce gets 406", () => {
  assert.equal(negotiate("application/pdf"), NOT_ACCEPTABLE);
  assert.equal(negotiate("image/png, image/jpeg"), NOT_ACCEPTABLE);
  assert.equal(negotiate("application/json"), NOT_ACCEPTABLE);
});

test("React Server Component requests are not acceptable here, so the proxy must exempt them", () => {
  // Guards the reason src/proxy.ts skips negotiation when the RSC header is
  // present: answering 406 to Next.js's own navigation fetches would break
  // client-side routing across the whole app.
  assert.equal(negotiate("text/x-component"), NOT_ACCEPTABLE);
});

test("a malformed header degrades to no preference instead of throwing", () => {
  assert.equal(negotiate("garbage"), HTML);
  assert.equal(negotiate(",,,"), HTML);
  assert.equal(negotiate("text/"), HTML);
  assert.equal(negotiate("/html"), HTML);
  assert.equal(negotiate("text/html;q=notanumber"), HTML);
});

test("matching is case-insensitive and tolerates whitespace", () => {
  assert.equal(negotiate("TEXT/MARKDOWN"), MARKDOWN);
  assert.equal(negotiate("  text/markdown  ;  q=0.9  "), MARKDOWN);
});

test("weights are clamped into range rather than rejected", () => {
  assert.deepEqual(parseAcceptHeader("text/html;q=5"), [
    { type: "text", subtype: "html", quality: 1 },
  ]);
  assert.deepEqual(parseAcceptHeader("text/html;q=-3"), [
    { type: "text", subtype: "html", quality: 0 },
  ]);
});

test("parseAcceptHeader skips unparseable entries and keeps the rest", () => {
  assert.deepEqual(parseAcceptHeader("garbage, text/markdown;q=0.4, /nope, text/html"), [
    { type: "text", subtype: "markdown", quality: 0.4 },
    { type: "text", subtype: "html", quality: 1 },
  ]);
});

test("qualityFor reports null for a type the header never matches", () => {
  const ranges = parseAcceptHeader("text/html");
  assert.equal(qualityFor(ranges, "text/markdown"), null);
  assert.equal(qualityFor(ranges, "text/html"), 1);
});

test("offering nothing is a 406 rather than an undefined representation", () => {
  assert.equal(negotiateMediaType("*/*", []), NOT_ACCEPTABLE);
});
