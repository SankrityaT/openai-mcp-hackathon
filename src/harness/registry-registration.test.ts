import assert from "node:assert/strict";
import test from "node:test";
import {
  CART_PERMALINK_CAPABILITY_ID,
  CART_PERMALINK_PROVIDER,
  cartPermalinkAdapter,
} from "./adapters/cart-permalink";
import { ComposioCapabilityAdapter } from "./adapters/composio-capability";
import { internalFixtureAdapter } from "./adapters/internal-fixture";
import { ShopifyCapabilityAdapter } from "./adapters/shopify-capability";
import { CapabilityRegistry } from "./capability-registry";
import type { CapabilityAdapter } from "./contracts";
import {
  DEFAULT_SAFE_CAPABILITY_IDS,
  DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS,
  SHOPIFY_SAFE_READ_CAPABILITY_IDS,
} from "../core/contracts/safe-capabilities";

/**
 * Mirrors `buildRegistry` in `inngest/functions.ts`, adapter for adapter.
 *
 * Deliberately a mirror rather than an import: `functions.ts` pulls in the
 * Inngest client, Supabase, and the notification stack at module load, none of
 * which belong in a plain `node --test` process. The registry throws on a
 * duplicate provider key and on a duplicate capability id, so constructing the
 * same set here is what proves the real one can be constructed at all.
 *
 * `enabled` / `env` are forced on so both env-gated adapters discover their
 * full descriptor set, which is strictly the harder case: a deployment with
 * nothing configured discovers a subset of what is asserted here.
 */
function adaptersLikeBuildRegistry(): CapabilityAdapter[] {
  return [
    internalFixtureAdapter,
    new ComposioCapabilityAdapter({ identityId: "identity-1", enabled: true }),
    cartPermalinkAdapter,
    new ShopifyCapabilityAdapter({ env: { CARDEA_SHOPIFY_STORE_DOMAIN: "example-store.com" } }),
  ];
}

test("every adapter the harness registers claims a distinct provider key", () => {
  const adapters = adaptersLikeBuildRegistry();
  const providers = adapters.map((adapter) => adapter.provider);
  assert.deepEqual(
    providers,
    [...new Set(providers)],
    `duplicate provider key among ${providers.join(", ")}`,
  );
  assert.ok(providers.includes(CART_PERMALINK_PROVIDER));
  assert.ok(providers.includes("shopify"));

  // The registry itself is the enforcement, so run it.
  const registry = new CapabilityRegistry();
  for (const adapter of adapters) registry.register(adapter);
});

test("registering the same provider twice is refused", () => {
  const registry = new CapabilityRegistry();
  registry.register(cartPermalinkAdapter);
  assert.throws(
    () => registry.register(cartPermalinkAdapter),
    /Capability adapter already registered/,
  );
});

test("discovery across the full adapter set yields no duplicate capability id", async () => {
  const registry = new CapabilityRegistry();
  for (const adapter of adaptersLikeBuildRegistry()) registry.register(adapter);

  const discovered = await registry.discover();
  const ids = discovered.map((capability) => capability.id);
  assert.deepEqual(ids, [...new Set(ids)], `duplicate capability id among ${ids.join(", ")}`);

  assert.ok(ids.includes(CART_PERMALINK_CAPABILITY_ID));
  for (const id of [...SHOPIFY_SAFE_READ_CAPABILITY_IDS, ...SHOPIFY_APPROVAL_GATED_CAPABILITY_IDS]) {
    assert.ok(ids.includes(id), `${id} was never discovered`);
  }
});

test("the mandate names every discoverable capability, and gates exactly the cart writes", async () => {
  const registry = new CapabilityRegistry();
  for (const adapter of adaptersLikeBuildRegistry()) registry.register(adapter);
  const discovered = await registry.discover();

  const admitted = new Set([
    ...DEFAULT_SAFE_CAPABILITY_IDS,
    ...DEFAULT_APPROVAL_GATED_CAPABILITY_IDS,
  ]);
  for (const capability of discovered) {
    assert.ok(admitted.has(capability.id), `${capability.id} is discoverable but not in the mandate`);
  }

  // A capability that writes is gated; a capability that reads is not.
  const gated = new Set(DEFAULT_APPROVAL_GATED_CAPABILITY_IDS);
  for (const capability of discovered) {
    assert.equal(
      gated.has(capability.id),
      !capability.readOnly,
      `${capability.id} gating does not match its readOnly flag`,
    );
  }
});

test("an unconfigured Shopify store leaves the registry buildable and silent", async () => {
  const registry = new CapabilityRegistry();
  registry.register(internalFixtureAdapter);
  registry.register(new ComposioCapabilityAdapter({ identityId: "identity-1", enabled: false }));
  registry.register(cartPermalinkAdapter);
  registry.register(new ShopifyCapabilityAdapter({ env: {} }));

  const ids = (await registry.discover()).map((capability) => capability.id);
  assert.deepEqual(ids.filter((id) => id.startsWith("shopify.")), []);
  // The permalink path never depends on Shopify configuration.
  assert.ok(ids.includes(CART_PERMALINK_CAPABILITY_ID));
});
