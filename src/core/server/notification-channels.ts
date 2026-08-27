import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/core/database.types";

/**
 * Read and write a person's reach-me preference.
 *
 * The row is a preference and nothing else: it records that the account
 * holder asked to be emailed when a mission stops for their judgment. There
 * is no address here — the destination is the account's own sign-in email,
 * resolved from `auth.users` at send time by the notify function.
 *
 * The two owner-facing writes go through the caller's own RLS-scoped client,
 * so the row is bound to `auth.uid()` twice over: once by the value written
 * and once by the insert/update policy. The read used by the notify function
 * takes an admin client, because a background function has no session; it is
 * still narrowed to the single user id resolved from the mission's tenant.
 */

type Client = SupabaseClient<Database>;

export const EMAIL_CHANNEL_KIND = "email" as const;

export type EmailChannelStatus = { enabled: boolean };

/**
 * The caller's own email channel, or null when they have never turned it on.
 * A missing table (a deployment that has not applied
 * 20260827120000_notification_channels.sql yet) reads as "never turned on"
 * rather than as an error, so the settings surface degrades to "Off".
 */
export async function readEmailChannel(
  client: Client,
  userId: string,
): Promise<EmailChannelStatus | null> {
  try {
    const { data, error } = await client
      .from("notification_channels")
      .select("enabled")
      .eq("user_id", userId)
      .eq("kind", EMAIL_CHANNEL_KIND)
      .maybeSingle();
    if (error || !data) return null;
    return { enabled: data.enabled };
  } catch {
    return null;
  }
}

/** Turns the channel on, creating the row the first time. Idempotent. */
export async function enableEmailChannel(client: Client, userId: string): Promise<boolean> {
  try {
    const { error } = await client.from("notification_channels").upsert(
      {
        user_id: userId,
        kind: EMAIL_CHANNEL_KIND,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,kind" },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Turns the channel off. The row is kept rather than deleted so turning it
 * back on is one write and the original opt-in date survives; a person who
 * has never opted in and disables anyway is a no-op, not an error.
 */
export async function disableEmailChannel(client: Client, userId: string): Promise<boolean> {
  try {
    const { error } = await client
      .from("notification_channels")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("kind", EMAIL_CHANNEL_KIND);
    return !error;
  } catch {
    return false;
  }
}
