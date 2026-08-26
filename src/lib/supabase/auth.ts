import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/core/database.types";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

export async function requireAuthenticatedUser(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getClaims();
  const subject = data?.claims?.sub;
  if (error || typeof subject !== "string" || subject.length === 0) {
    throw new AuthenticationRequiredError();
  }
  return { userId: subject, claims: data!.claims };
}
