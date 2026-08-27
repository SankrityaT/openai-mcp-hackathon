import { readBoundedJsonBody } from "@/core/contracts/commands";
import { jsonResponse, safeHttpError } from "@/core/server/http";
import { enforceRateLimit } from "@/core/server/rate-limit";
import { readIpSignalHash } from "@/core/server/request-signals";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CapabilityProviderError } from "@/harness/capability-errors";
import { ShopifyCapabilityAdapter } from "@/harness/adapters/shopify-capability";
import { parseShopifyExecuteBody, SHOPIFY_REQUEST_LIMITS } from "../execute-request";

/**
 * Thin authenticated seam onto the Shopify storefront capability adapter.
 *
 * `GET`  — reports whether a store is configured, so the canvas can render a
 *          truthful state instead of guessing.
 * `POST` — executes exactly one allowlisted capability and returns bounded
 *          untrusted evidence.
 *
 * The route holds no Shopify logic of its own. It authenticates, bounds the
 * request, and delegates; the adapter owns the tool allowlist, the checkout
 * refusal, and the evidence shaping. Deleting this directory removes the
 * network surface without touching a contract.
 *
 * NO SECRETS PASS THROUGH HERE. Shopify's storefront MCP endpoints are public
 * and unauthenticated for catalog and cart data, so there is no token to leak.
 * Authentication on this route exists to stop Cardea being used as an open
 * proxy against arbitrary storefronts, not to protect a credential.
 */

function adapter() {
  // Constructed per request so a configuration change takes effect without a
  // process restart, and so no cross-request state can accumulate.
  return new ShopifyCapabilityAdapter();
}

export async function GET(request: Request) {
  try {
    // Reuses the existing external-integration budget rather than adding a
    // route class, because `RateLimitRouteClass` lives in `src/core`, which this
    // optional spike deliberately does not modify. Sharing the bucket is the
    // conservative direction: it can only tighten, never loosen, the ceiling.
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const client = await createSupabaseServerClient();
    await requireAuthenticatedUser(client);

    const instance = adapter();
    const status = instance.status();
    return jsonResponse({
      status,
      capabilities: await instance.discover(),
    });
  } catch (error) {
    return safeHttpError(error);
  }
}

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit("composio", readIpSignalHash(request));
    if (limited) return limited;

    const client = await createSupabaseServerClient();
    await requireAuthenticatedUser(client);

    const body = await readBoundedJsonBody(request, SHOPIFY_REQUEST_LIMITS.maxBodyBytes);

    const parsed = parseShopifyExecuteBody(body);
    if (!parsed.ok) {
      return jsonResponse({ error: "invalid_request", reason: parsed.reason }, { status: 400 });
    }
    const command = parsed.command;

    const instance = adapter();
    const status = instance.status();
    if (!status.configured) {
      // A deployment with no store configured is a normal state, not an error
      // the user should be made to debug.
      return jsonResponse({ error: "not_configured", reason: status.reason }, { status: 404 });
    }

    try {
      const result = await instance.execute({
        capabilityId: command.capabilityId,
        missionId: command.missionId ?? "unassigned",
        input: command.input as never,
        correlationId: command.correlationId ?? crypto.randomUUID(),
        idempotencyKey: command.idempotencyKey ?? crypto.randomUUID(),
      });
      return jsonResponse({ status, result });
    } catch (error) {
      if (!(error instanceof CapabilityProviderError)) throw error;
      // A provider failure is the storefront's problem, not a Cardea crash. The
      // reason is an enum this adapter produced, never raw upstream text, so it
      // is safe to echo and lets the canvas say what actually happened.
      const clientFault =
        error.reason.startsWith("invalid_input") ||
        error.reason === "tool_not_allowed" ||
        error.reason === "checkout_tool_refused";
      return jsonResponse(
        { error: "capability_failed", provider: error.provider, reason: error.reason },
        { status: clientFault ? 400 : 502 },
      );
    }
  } catch (error) {
    return safeHttpError(error);
  }
}
