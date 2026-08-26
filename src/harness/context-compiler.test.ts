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
