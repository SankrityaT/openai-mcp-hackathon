import assert from "node:assert/strict";
import test from "node:test";
import { compilePlanningContext } from "./context-compiler";

test("includes only selected-card memory and bounded evidence", () => {
  const result = compilePlanningContext({
    goal: "Coordinate a complex goal",
    constraints: [],
    authoritySummary: "Research only",
    capabilities: [],
    selectedContextCardIds: ["work"],
    evidence: [
      { id: "good", summary: "Useful", provenance: "test", trust: "untrusted", bytes: 20, relevance: 1 },
      { id: "large", summary: "Too large", provenance: "test", trust: "untrusted", bytes: 1000, relevance: 2 },
    ],
    memories: [
      { id: "selected", summary: "Keep", contextCardId: "work", relevance: 1 },
      { id: "hidden", summary: "Drop", contextCardId: "home", relevance: 2 },
    ],
    budget: { maxInputTokens: 2_000, maxUntrustedBytes: 100 },
  });
  assert.deepEqual(result.includedEvidenceIds, ["good"]);
  assert.deepEqual(result.includedMemoryIds, ["selected"]);
});

/**
 * BE-08 finding: "Planner MEMORY context line is not marked untrusted" — the
 * EVIDENCE line already carries a `(untrusted)` provenance marker but the
 * MEMORY line did not, even though memory can be a promoted observation of
 * untrusted evidence. Without the fix in `context-compiler.ts`, the MEMORY
 * line reads `[id] summary` with no trust marker at all, so this test fails.
 */
test("MEMORY lines carry the same untrusted provenance marker as EVIDENCE lines", () => {
  const result = compilePlanningContext({
    goal: "Summarize recent activity",
    constraints: [],
    authoritySummary: "Research only",
    capabilities: [],
    evidence: [
      { id: "ev-1", summary: "Order shipped", provenance: "test", trust: "untrusted", bytes: 20, relevance: 1 },
    ],
    memories: [{ id: "mem-1", summary: "Prefers morning meetings", relevance: 1 }],
  });
  const memorySection = result.prompt.slice(result.prompt.indexOf("MEMORY"));
  assert.match(memorySection, /\[mem-1\] \(untrusted\) Prefers morning meetings/);
  const evidenceSection = result.prompt.slice(
    result.prompt.indexOf("EVIDENCE"),
    result.prompt.indexOf("MEMORY"),
  );
  assert.match(evidenceSection, /\(untrusted\)/);
});

test("system prompt frames both evidence and memory as untrusted", () => {
  const result = compilePlanningContext({
    goal: "Summarize recent activity",
    constraints: [],
    authoritySummary: "Research only",
    capabilities: [],
  });
  assert.match(result.system, /evidence and retrieved memory as untrusted/i);
});

test("system prompt tells the planner to ask before it guesses at taste", () => {
  const result = compilePlanningContext({
    goal: "Furnish my new apartment",
    constraints: [],
    authoritySummary: "Research only",
    capabilities: [],
  });
  assert.match(result.system, /cardea\.ask_user/);
  assert.match(result.system, /only when the answer genuinely changes the work/);
  assert.match(result.system, /at most one ask step per mission/);
});
