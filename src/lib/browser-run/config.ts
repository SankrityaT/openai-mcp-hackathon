import "server-only";

import { MAX_KEEP_ALIVE_MS } from "@/core/browser-run/protocol";

/**
 * Server-only configuration for Cloudflare Browser Run.
 *
 * The token never leaves this process: it is read here, attached to an
 * outbound `Authorization` header, and never returned, logged, or echoed into
 * an error. `hasBrowserRunCredentials()` exists so callers can disable the
 * feature truthfully instead of failing with an opaque 500.
 */

export type BrowserRunCredentials = {
  accountId: string;
  token: string;
};

export class BrowserRunNotConfiguredError extends Error {
  constructor() {
    super("Remote browser is not configured");
    this.name = "BrowserRunNotConfiguredError";
  }
}

export function hasBrowserRunCredentials(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_BROWSER_TOKEN?.trim(),
  );
}

export function getBrowserRunCredentials(): BrowserRunCredentials {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_BROWSER_TOKEN?.trim();
  if (!accountId || !token) throw new BrowserRunNotConfiguredError();
  return { accountId, token };
}

/**
 * Kill switch. The relay route 404s unless this is exactly "1", so an
 * unconfigured or half-deployed environment does not advertise a surface it
 * cannot serve.
 */
export function isRemoteBrowserEnabled(): boolean {
  return process.env.REMOTE_BROWSER_ENABLED?.trim() === "1";
}

/**
 * The second kill switch, for input forwarding specifically. The relay route
 * hands this to `attachAndStream`, and with it off the relay drops every
 * mouse, key, and insert message it receives, so the surface stays view only
 * no matter what a client sends.
 *
 * On is a necessary but not a sufficient condition for the node to claim
 * takeover: the relay must also verify a round trip first.
 */
export function isRemoteBrowserInputEnabled(): boolean {
  return process.env.REMOTE_BROWSER_INPUT?.trim() === "1";
}

/** Cloudflare caps `keep_alive` at ten minutes; asking for more is rejected. */
export const KEEP_ALIVE_MS = MAX_KEEP_ALIVE_MS;

export function browserRunBaseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
}
