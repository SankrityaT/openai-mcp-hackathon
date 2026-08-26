"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/core/database.types";
import { getSupabasePublicConfig } from "./public-env";

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}
