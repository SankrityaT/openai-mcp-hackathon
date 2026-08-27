import "server-only";

export function getSupabaseSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Required server configuration is missing: SUPABASE_SECRET_KEY");
  return key;
}

/**
 * True when a server-only Supabase credential is configured. Used to disable
 * server-role features truthfully instead of failing with an opaque error.
 * The value itself is never returned or logged.
 */
export function hasSupabaseSecretKey() {
  return Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}
