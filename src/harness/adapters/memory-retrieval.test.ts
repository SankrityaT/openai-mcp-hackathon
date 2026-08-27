import assert from "node:assert/strict";
import test from "node:test";
import { retrieveMemoryForContext, type MemorySearchFn } from "./memory-retrieval";

function fakeSearch(
  memories: Array<{ id: string; text: string; similarity?: number; metadata?: Record<string, unknown> }>,
): MemorySearchFn {
  return (async () => ({
    available: true as const,
    memories: memories.map((memory) => ({
      id: memory.id,
      text: memory.text,
      similarity: memory.similarity,
      version: 1,
      metadata: memory.metadata,
    })),
  })) as unknown as MemorySearchFn;
}

test("excludes memories scoped to a context card that was not selected", async () => {
  const search = fakeSearch([
    { id: "mem-a", text: "Prefers window seats", similarity: 0.9, metadata: { contextCardId: "card-1" } },
    { id: "mem-b", text: "Vegetarian diet", similarity: 0.8, metadata: { contextCardId: "card-2" } },
    { id: "mem-c", text: "Global note with no card", similarity: 0.7 },
  ]);
  const result = await retrieveMemoryForContext(
    { userId: "user-1", query: "preferences", selectedContextCardIds: ["card-1"] },
    { search },
  );
  assert.equal(result.available, true);
  const ids = result.items.map((item) => item.id);
  assert.deepEqual(ids, ["mem-a", "mem-c"]);
});

test("every item carries provenance and a bounded summary", async () => {
  const longText = "y".repeat(5_000);
  const search = fakeSearch([{ id: "mem-long", text: longText, similarity: 0.5, metadata: { source: "email" } }]);
  const result = await retrieveMemoryForContext(
    { userId: "user-1", query: "q", selectedContextCardIds: [] },
    { search },
  );
  const [item] = result.items;
  assert.equal(item?.provenance, "supermemory");
  assert.equal(item?.source, "email");
  assert.equal(item?.externalRef, "mem-long");
  assert.ok(Buffer.byteLength(item!.summary, "utf8") < longText.length);
});

test("degrades visibly instead of throwing when the provider is unavailable", async () => {
  const search: MemorySearchFn = (async () => ({
    available: false as const,
    memories: [],
  })) as unknown as MemorySearchFn;
  const result = await retrieveMemoryForContext(
    { userId: "user-1", query: "q", selectedContextCardIds: [] },
    { search },
  );
  assert.deepEqual(result, { available: false, items: [] });
});

test("limit is bounded between 1 and 20", async () => {
  const search = fakeSearch(
    Array.from({ length: 30 }, (_, index) => ({ id: `mem-${index}`, text: `note ${index}`, similarity: 1 - index / 30 })),
  );
  const result = await retrieveMemoryForContext(
    { userId: "user-1", query: "q", selectedContextCardIds: [], limit: 500 },
    { search },
  );
  assert.equal(result.items.length <= 20, true);
});
