import assert from "node:assert/strict";
import test from "node:test";
import {
  type BoardApproval,
  type BoardSpineNode,
  type BoardWalletPass,
  codenameForNode,
  toApprovalSummaries,
  toCardeaDataMode,
  toNodeSummaries,
  toWalletPassSummaries,
  workspaceSwitchResult,
  sanitizePageUrls,
  openPagesResult,
  MAX_OPEN_PAGES,
} from "./board-mission-actions";

const NODES: BoardSpineNode[] = [
  { id: "node-1", codename: "SCOUT", roleLabel: "Research", status: "running" },
  { id: "node-2", codename: "LEDGER", roleLabel: "Reconciliation", status: "paused" },
];

test("toCardeaDataMode reports live only when persistence is available", () => {
  assert.equal(toCardeaDataMode({ persistenceAvailable: true }), "live");
});

test("toCardeaDataMode reports fixture for a board that cannot persist", () => {
  assert.equal(toCardeaDataMode({ persistenceAvailable: false }), "fixture");
});

test("toNodeSummaries renames roleLabel to role and preserves order", () => {
  assert.deepEqual(toNodeSummaries(NODES), [
    { id: "node-1", codename: "SCOUT", role: "Research", status: "running" },
    { id: "node-2", codename: "LEDGER", role: "Reconciliation", status: "paused" },
  ]);
});

test("toNodeSummaries maps an empty spine to an empty list", () => {
  assert.deepEqual(toNodeSummaries([]), []);
});

test("toNodeSummaries invents no fields beyond the tool summary shape", () => {
  const [summary] = toNodeSummaries(NODES);
  assert.deepEqual(Object.keys(summary).sort(), ["codename", "id", "role", "status"]);
});

test("codenameForNode returns the codename of a known node", () => {
  assert.equal(codenameForNode(NODES, "node-2"), "LEDGER");
});

test("codenameForNode returns null for an unknown node", () => {
  assert.equal(codenameForNode(NODES, "node-404"), null);
});

test("codenameForNode returns null against an empty spine", () => {
  assert.equal(codenameForNode([], "node-1"), null);
});

function approval(overrides: Partial<BoardApproval> = {}): BoardApproval {
  return {
    id: "approval-1",
    nodeId: "node-1",
    category: "ask_user",
    recommendation: "Which flight should Cardea book?",
    alternatives: [],
    consequence: "Nothing is booked until you choose.",
    status: "pending",
    ...overrides,
  };
}

test("toApprovalSummaries maps an empty list to an empty list", () => {
  assert.deepEqual(toApprovalSummaries([]), []);
});

test("toApprovalSummaries carries the question, consequence, and identity through", () => {
  assert.deepEqual(toApprovalSummaries([approval()]), [
    {
      id: "approval-1",
      nodeId: "node-1",
      category: "ask_user",
      question: "Which flight should Cardea book?",
      options: [],
      consequence: "Nothing is booked until you choose.",
      status: "pending",
    },
  ]);
});

test("toApprovalSummaries preserves a null nodeId rather than inventing one", () => {
  const [summary] = toApprovalSummaries([approval({ nodeId: null })]);
  assert.equal(summary.nodeId, null);
});

test("toApprovalSummaries passes string alternatives through unchanged", () => {
  const [summary] = toApprovalSummaries([
    approval({ alternatives: ["Morning departure", "Red-eye"] }),
  ]);
  assert.deepEqual(summary.options, ["Morning departure", "Red-eye"]);
});

test("toApprovalSummaries prefers a non-empty summary field on an object alternative", () => {
  const [summary] = toApprovalSummaries([
    approval({ alternatives: [{ summary: "Refundable fare", price: 412 }] }),
  ]);
  assert.deepEqual(summary.options, ["Refundable fare"]);
});

test("toApprovalSummaries falls back to bounded JSON for a blank summary", () => {
  const [summary] = toApprovalSummaries([
    approval({ alternatives: [{ summary: "   ", price: 412 }] }),
  ]);
  assert.deepEqual(summary.options, ['{"summary":"   ","price":412}']);
});

test("toApprovalSummaries describes unknown alternative shapes as bounded JSON", () => {
  const [summary] = toApprovalSummaries([
    approval({ alternatives: [42, ["a", "b"], null, true] }),
  ]);
  assert.deepEqual(summary.options, ["42", '["a","b"]', "null", "true"]);
});

test("toApprovalSummaries bounds an opaque alternative to 160 characters plus an ellipsis", () => {
  const [summary] = toApprovalSummaries([
    approval({ alternatives: [{ note: "n".repeat(400) }] }),
  ]);
  assert.equal(summary.options[0].length, 161);
  assert.ok(summary.options[0].endsWith("…"));
});

test("toApprovalSummaries caps the option list at eight entries", () => {
  const [summary] = toApprovalSummaries([
    approval({
      alternatives: Array.from({ length: 12 }, (_, index) => `option-${index}`),
    }),
  ]);
  assert.equal(summary.options.length, 8);
  assert.equal(summary.options[7], "option-7");
});

test("toApprovalSummaries bounds the question to 300 characters with an ellipsis", () => {
  const [summary] = toApprovalSummaries([approval({ recommendation: "q".repeat(400) })]);
  assert.equal(summary.question, `${"q".repeat(300)}…`);
});

test("toApprovalSummaries leaves a question at the bound unmarked", () => {
  const [summary] = toApprovalSummaries([approval({ recommendation: "q".repeat(300) })]);
  assert.equal(summary.question, "q".repeat(300));
});

test("toApprovalSummaries bounds the consequence to 300 characters with an ellipsis", () => {
  const [summary] = toApprovalSummaries([approval({ consequence: "c".repeat(512) })]);
  assert.equal(summary.consequence, `${"c".repeat(300)}…`);
});

test("toApprovalSummaries bounds a long string option to 300 characters", () => {
  const [summary] = toApprovalSummaries([approval({ alternatives: ["o".repeat(900)] })]);
  assert.equal(summary.options[0], `${"o".repeat(300)}…`);
});

test("toApprovalSummaries maps every pending approval, not only the first", () => {
  const summaries = toApprovalSummaries([
    approval(),
    approval({ id: "approval-2", recommendation: "Send the deposit?" }),
  ]);
  assert.deepEqual(
    summaries.map((entry) => entry.id),
    ["approval-1", "approval-2"],
  );
});

test("toApprovalSummaries invents no fields beyond the approval summary shape", () => {
  const [summary] = toApprovalSummaries([approval()]);
  assert.deepEqual(Object.keys(summary).sort(), [
    "category",
    "consequence",
    "id",
    "nodeId",
    "options",
    "question",
    "status",
  ]);
});

test("workspaceSwitchResult reports the switch it actually performed", () => {
  assert.deepEqual(JSON.parse(workspaceSwitchResult("mission-7", true)), {
    ok: true,
    persisted: false,
    scope: "ui_local",
    visibleEffect: "workspace_switched",
    missionId: "mission-7",
  });
});

test("workspaceSwitchResult refuses a mission the strip does not know", () => {
  const refused = JSON.parse(workspaceSwitchResult("mission-404", false)) as {
    ok: boolean;
    visibleEffect: string;
    error: { code: string; message: string };
  };
  assert.equal(refused.ok, false);
  assert.equal(refused.visibleEffect, "none");
  assert.equal(refused.error.code, "unknown_mission");
  assert.ok(refused.error.message.length > 0);
});

test("workspaceSwitchResult refusal does not echo the rejected mission id", () => {
  const refused = JSON.parse(workspaceSwitchResult("mission-404", false)) as Record<string, unknown>;
  assert.equal("missionId" in refused, false);
});

test("workspaceSwitchResult claims interface scope and no persistence either way", () => {
  const switched = JSON.parse(workspaceSwitchResult("mission-7", true)) as Record<string, unknown>;
  assert.equal(switched.persisted, false);
  assert.equal(switched.scope, "ui_local");
  const refused = JSON.parse(workspaceSwitchResult("mission-404", false)) as Record<string, unknown>;
  assert.equal(refused.persisted, false);
  assert.equal(refused.scope, "ui_local");
});

test("sanitizePageUrls keeps only https urls, deduplicated and bounded", () => {
  assert.deepEqual(
    sanitizePageUrls([
      "https://target.com/p/desk",
      "http://insecure.example.com",
      "https://target.com/p/desk",
      "javascript:alert(1)",
      "not a url",
      42,
      "https://wayfair.com/lamp",
      "https://ikea.com/bed",
      "https://one-too-many.example.com",
    ]),
    ["https://target.com/p/desk", "https://wayfair.com/lamp", "https://ikea.com/bed"],
  );
});

test("sanitizePageUrls caps the count at the session budget bound", () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
  assert.equal(sanitizePageUrls(urls).length, MAX_OPEN_PAGES);
});

test("sanitizePageUrls refuses non-arrays and oversized urls", () => {
  assert.deepEqual(sanitizePageUrls("https://example.com"), []);
  assert.deepEqual(sanitizePageUrls(null), []);
  assert.deepEqual(sanitizePageUrls([`https://example.com/${"x".repeat(2100)}`]), []);
});

test("openPagesResult names exactly what opened", () => {
  assert.deepEqual(JSON.parse(openPagesResult(["https://a.com/", "https://b.com/"])), {
    ok: true,
    persisted: false,
    scope: "ui_local",
    visibleEffect: "pages_opened",
    opened: 2,
    urls: ["https://a.com/", "https://b.com/"],
  });
});

test("openPagesResult refuses without echoing rejected input, and says what would pass", () => {
  const refused = JSON.parse(openPagesResult([])) as {
    ok: boolean;
    error: { code: string; message: string };
  } & Record<string, unknown>;
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "no_valid_urls");
  assert.match(refused.error.message, /https/);
  assert.equal("urls" in refused, false);
});

const PASSES: BoardWalletPass[] = [
  { id: "pass-personal", label: "Personal", domain: "personal" },
  { id: "pass-travel", label: "Travel", domain: "travel" },
  { id: "pass-work", label: "Work", domain: "work" },
];

test("toWalletPassSummaries marks selection and loaded amount for each pass", () => {
  assert.deepEqual(
    toWalletPassSummaries(PASSES, ["pass-personal", "pass-travel"], { "pass-travel": 250 }),
    [
      { id: "pass-personal", label: "Personal", domain: "personal", selected: true, loadedUsd: 0 },
      { id: "pass-travel", label: "Travel", domain: "travel", selected: true, loadedUsd: 250 },
      { id: "pass-work", label: "Work", domain: "work", selected: false, loadedUsd: 0 },
    ],
  );
});

test("toWalletPassSummaries reports every pass unselected when nothing is chosen", () => {
  const summaries = toWalletPassSummaries(PASSES, [], {});
  assert.equal(summaries.every((pass) => !pass.selected), true);
});

test("toWalletPassSummaries maps an empty pass list to an empty list", () => {
  assert.deepEqual(toWalletPassSummaries([], ["pass-personal"], { "pass-personal": 100 }), []);
});

test("toWalletPassSummaries ignores an amount for a pass id not present in the list", () => {
  const summaries = toWalletPassSummaries(PASSES, [], { "pass-ghost": 500 });
  assert.equal(summaries.every((pass) => pass.loadedUsd === 0), true);
});

test("toWalletPassSummaries invents no fields beyond the wallet summary shape", () => {
  const [summary] = toWalletPassSummaries(PASSES, [], {});
  assert.deepEqual(Object.keys(summary).sort(), ["domain", "id", "label", "loadedUsd", "selected"]);
});
