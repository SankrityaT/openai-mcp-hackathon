import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const otpTypes = new Set<EmailOtpType>([
  "email",
  "recovery",
  "invite",
  "email_change",
  "magiclink",
]);

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/canvas";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const client = await createSupabaseServerClient();
  let error: unknown = null;

  if (code) {
    ({ error } = await client.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type && otpTypes.has(type)) {
    ({ error } = await client.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = new Error("Missing authentication callback parameters");
  }

  const destination = error ? "/canvas?auth=error" : safeNextPath(url.searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, url.origin));
}
