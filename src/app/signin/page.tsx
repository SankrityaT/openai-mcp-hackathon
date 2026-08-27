import type { Metadata } from "next";
import { SignInView } from "./_components/sign-in-view";

export const metadata: Metadata = {
  title: "Sign in to Cardea",
  description: "Sign in to keep your Cardea missions, memory, and connected apps.",
};

/** Bounded, same-origin-only. Mirrors the rule in /auth/callback. */
function safeNext(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  return <SignInView next={safeNext(params.next)} />;
}
