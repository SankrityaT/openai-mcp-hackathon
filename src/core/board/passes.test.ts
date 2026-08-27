import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PASS_AMOUNT_USD,
  MICROUNITS_PER_USD,
  STARTER_PASSES,
  formatPassAmount,
  passById,
  toBudgetMicrounits,
} from "./passes";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The ids are pinned in the test as well as the source. A pass id keys stored
 * wallet state, so a "harmless" regeneration must fail here rather than
 * silently unselect every saved pass in the field.
 */
const PINNED_IDS = [
  "5f8a2c14-3d6b-4a9e-9c71-2e0b7d4f16a3",
  "b1c47e08-9a52-4f3d-8e6a-71c9d2035b84",
  "3e2d9f61-47c8-4b05-a9d3-6f81b0e75c22",
  "c86b41d7-20fa-4e19-b7c5-93d8a6210fe4",
  "7a45d3b9-6e10-4c82-8f0d-15b3e9c47a6d",
];

test("the deck is the five locked starter passes in order", () => {
  assert.deepEqual(
    STARTER_PASSES.map((pass) => pass.domain),
    ["personal", "work", "home", "shopping", "travel"],
  );
  assert.deepEqual(
    STARTER_PASSES.map((pass) => pass.label),
    ["Personal", "Work", "Home", "Shopping", "Travel"],
  );
});

test("pass ids are valid v4 uuids and stable across releases", () => {
  assert.deepEqual(STARTER_PASSES.map((pass) => pass.id), PINNED_IDS);
  for (const pass of STARTER_PASSES) assert.match(pass.id, UUID_V4);
  assert.equal(new Set(PINNED_IDS).size, PINNED_IDS.length);
});

test("art paths point at the committed pass artwork for their own domain", () => {
  for (const pass of STARTER_PASSES) {
    assert.equal(pass.art, `/images/cardea/passes/${pass.domain}.webp`);
  }
});

test("descriptions are one honest sentence and carry no em dash", () => {
  for (const pass of STARTER_PASSES) {
    assert.ok(pass.description.length > 30, `${pass.domain} description is too thin`);
    assert.ok(pass.description.length <= 120, `${pass.domain} description is too long`);
    assert.ok(pass.description.endsWith("."), `${pass.domain} description is not a sentence`);
    // Locked copy rule: never an em dash, and never an en dash standing in for one.
    assert.doesNotMatch(pass.description, /[—–]/);
    // Sentence case: a capital first letter, nothing shouted after it.
    assert.match(pass.description, /^[A-Z]/);
    assert.doesNotMatch(pass.description, /\b[A-Z]{2,}\b/);
  }
});

test("toBudgetMicrounits converts whole dollars exactly", () => {
  assert.equal(toBudgetMicrounits(0), 0);
  assert.equal(toBudgetMicrounits(1), MICROUNITS_PER_USD);
  assert.equal(toBudgetMicrounits(50), 50 * MICROUNITS_PER_USD);
  assert.equal(toBudgetMicrounits(1250.5), 1_250_500_000);
});

test("toBudgetMicrounits clamps to the allowed boundary range", () => {
  assert.equal(toBudgetMicrounits(-1), 0);
  assert.equal(toBudgetMicrounits(-99_999), 0);
  assert.equal(toBudgetMicrounits(MAX_PASS_AMOUNT_USD), 10_000 * MICROUNITS_PER_USD);
  assert.equal(toBudgetMicrounits(MAX_PASS_AMOUNT_USD + 0.01), 10_000 * MICROUNITS_PER_USD);
  assert.equal(toBudgetMicrounits(1e12), 10_000 * MICROUNITS_PER_USD);
});

test("toBudgetMicrounits rounds to the nearest cent, half away from zero", () => {
  assert.equal(toBudgetMicrounits(0.004), 0);
  assert.equal(toBudgetMicrounits(0.005), 10_000);
  assert.equal(toBudgetMicrounits(0.006), 10_000);
  assert.equal(toBudgetMicrounits(12.344), 12_340_000);
  assert.equal(toBudgetMicrounits(12.345), 12_350_000);
  // 0.1 + 0.2 is 0.30000000000000004 in binary floating point. The stored
  // boundary must still be exactly thirty cents.
  assert.equal(toBudgetMicrounits(0.1 + 0.2), 300_000);
  assert.ok(Number.isInteger(toBudgetMicrounits(99.99)));
});

test("toBudgetMicrounits treats unusable input as unloaded", () => {
  assert.equal(toBudgetMicrounits(Number.NaN), 0);
  assert.equal(toBudgetMicrounits(Number.POSITIVE_INFINITY), 0);
  assert.equal(toBudgetMicrounits(Number.NEGATIVE_INFINITY), 0);
});

test("formatPassAmount drops empty cents and groups thousands", () => {
  assert.equal(formatPassAmount(0), "$0");
  assert.equal(formatPassAmount(25), "$25");
  assert.equal(formatPassAmount(50), "$50");
  assert.equal(formatPassAmount(1250.5), "$1,250.50");
  assert.equal(formatPassAmount(1250.05), "$1,250.05");
  assert.equal(formatPassAmount(10_000), "$10,000");
});

test("formatPassAmount shows the same clamped value that would be stored", () => {
  assert.equal(formatPassAmount(-40), "$0");
  assert.equal(formatPassAmount(Number.NaN), "$0");
  assert.equal(formatPassAmount(25_000), "$10,000");
  assert.equal(formatPassAmount(0.005), "$0.01");
});

test("passById resolves a known pass and refuses an unknown id", () => {
  const personal = passById(PINNED_IDS[0]);
  assert.equal(personal?.domain, "personal");
  assert.equal(personal?.label, "Personal");
  assert.equal(passById("not-a-uuid"), null);
  assert.equal(passById(""), null);
  assert.equal(passById("00000000-0000-4000-8000-000000000000"), null);
  // Prototype keys are not passes.
  assert.equal(passById("constructor"), null);
  assert.equal(passById("__proto__"), null);
});
