export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error("Required server configuration is missing: NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) {
    throw new Error(
      "Required server configuration is missing: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return { url, publishableKey };
}

export function getSupabaseSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Required server configuration is missing: SUPABASE_SECRET_KEY");
  return key;
}
