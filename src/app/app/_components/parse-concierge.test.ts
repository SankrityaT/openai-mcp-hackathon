import assert from "node:assert/strict";
import test from "node:test";
import { parseConcierge } from "./parse-concierge";

const BRIEF = [
  "found your best bet. annes flowers, $50-60 arrangements, solid local rep. opening their page now. which one you want?",
  "Option: Annes Flowers | https://annesflowers.example/birthday",
  "Option: Amazing Flowers | https://amazingflowers.example/midtown",
  "Option: Phoenix Flowers Delivery | https://phoenixflowers.example/under-60",
  "",
  "The receipts",
  "- Observed price range: $40 to $69.95.",
  "- Biggest caveat: downtown delivery coverage not directly observed.",
].join("\n");

test("parses spoken line, three options in order, and the receipts", () => {
  const parsed = parseConcierge(BRIEF);
  assert.match(parsed.spoken, /^found your best bet/);
  assert.equal(parsed.options.length, 3);
  assert.equal(parsed.options[0].label, "Annes Flowers");
  assert.equal(parsed.options[0].url, "https://annesflowers.example/birthday");
  assert.equal(parsed.options[2].label, "Phoenix Flowers Delivery");
  assert.match(parsed.receipts, /^The receipts/);
  assert.match(parsed.receipts, /price range/);
});

test("a brief without Option lines yields no options but keeps a fallback url", () => {
  const parsed = parseConcierge(
    "Here is a plain brief.\nOrder here: https://example.com/order\nDetails follow.",
  );
  assert.equal(parsed.options.length, 0);
  assert.equal(parsed.fallbackUrl, "https://example.com/order");
  assert.equal(parsed.receipts, "");
});

test("malformed and non-http option lines are skipped, at most three kept", () => {
  const parsed = parseConcierge(
    [
      "verdict line",
      "Option: no url here",
      "Option: ftp scheme | ftp://nope.example",
      "Option: A | https://a.example",
      "Option: B | https://b.example",
      "Option: C | https://c.example",
      "Option: D | https://d.example",
    ].join("\n"),
  );
  assert.deepEqual(
    parsed.options.map((option) => option.label),
    ["A", "B", "C"],
  );
});

test("empty text parses to an inert result", () => {
  const parsed = parseConcierge("");
  assert.equal(parsed.spoken, "");
  assert.equal(parsed.options.length, 0);
  assert.equal(parsed.fallbackUrl, null);
});
