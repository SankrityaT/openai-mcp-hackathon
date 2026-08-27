import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { hasSupabaseSessionConfig, refreshSupabaseSession } from "./proxy";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

async function withEnv<T>(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => T | Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("hasSupabaseSessionConfig requires both public credentials", async () => {
  await withEnv({}, () => {
    assert.equal(hasSupabaseSessionConfig(), false);
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }, () => {
    assert.equal(hasSupabaseSessionConfig(), false);
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key" }, () => {
    assert.equal(hasSupabaseSessionConfig(), false);
  });
  await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    },
    () => {
      assert.equal(hasSupabaseSessionConfig(), true);
    },
  );
});

test("refreshSupabaseSession skips cleanly with zero Supabase env (fixture mode)", async () => {
  await withEnv({}, async () => {
    const request = new NextRequest("https://cardea.example/canvas");
    // Must not throw: this is the exact `next dev`/build regression — a
    // missing NEXT_PUBLIC_SUPABASE_URL previously threw inside
    // `getSupabasePublicConfig` on every request.
    const response = await refreshSupabaseSession(request);
    assert.ok(response, "a response is still returned");
    assert.equal(response.status, 200);
  });
});
