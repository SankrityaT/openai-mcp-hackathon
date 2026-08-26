import "server-only";

export function getSupabaseSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Required server configuration is missing: SUPABASE_SECRET_KEY");
  return key;
}
