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
