/**
 * Composio connection orchestration, against a dummy SDK seam.
 *
 * No network call and no real OAuth: `ComposioConnectionsClient` is the
 * narrow structural slice the adapter uses, so a plain object stands in for
 * `@composio/core` the way `composio-capability.test.ts` substitutes its
 * executor. What these tests pin is the part a live flow cannot easily
 * prove: that every provider call is filtered by the caller's own entity,
 * that only the two exactly named auth configs are ever used, and that
 * nothing credential-shaped survives into a return value.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  disconnectComposioConnection,
  listComposioConnections,
  resolveComposioAuthConfigId,
  startComposioConnection,
  type ComposioConnectionsClient,
} from "./composio-connections";
import type { RawComposioConnection } from "./composio-connection-contract";

const SECRET_FIELD_PATTERN = /token|secret|refresh|access_key/i;

const CALLBACK_URL = "https://cardea.example/settings/integrations?toolkit=gmail";

type ListQuery = { userIds?: string[]; toolkitSlugs?: string[]; limit?: number };
type AuthConfigQuery = { toolkit?: string; search?: string; limit?: number };

/**
 * A dummy Composio project holding two users' connections, the two named auth
 * configs, a decoy config on the same toolkit that the flow must never
 * select, and a disabled same-name config it must skip.
 */
function createDummyComposio() {
  const accounts: (RawComposioConnection & { userId: string })[] = [
    {
      id: "ca_alice_gmail",
      userId: "alice",
      status: "ACTIVE",
      toolkit: { slug: "gmail" },
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
    { id: "ca_bob_gmail", userId: "bob", status: "ACTIVE", toolkit: { slug: "gmail" } },
    {
      id: "ca_alice_calendar_dead",
      userId: "alice",
      status: "REVOKED",
      toolkit: { slug: "googlecalendar" },
    },
  ];
  const authConfigs = [
    { id: "ac_gmail_old", name: "cardea-gmail", toolkit: "gmail", status: "DISABLED" },
    { id: "ac_gmail", name: "cardea-gmail", toolkit: "gmail", status: "ENABLED" },
    { id: "ac_calendar", name: "cardea-calendar", toolkit: "googlecalendar", status: "ENABLED" },
    // A different team's config on the same toolkit. Selecting it would put a
    // Cardea user on someone else's OAuth app.
    { id: "ac_other", name: "someone-elses-gmail", toolkit: "gmail", status: "ENABLED" },
  ];

  const listCalls: ListQuery[] = [];
  const authConfigCalls: AuthConfigQuery[] = [];
  const linked: { userId: string; authConfigId: string; callbackUrl?: string }[] = [];
  const deleted: string[] = [];

  const client: ComposioConnectionsClient = {
    authConfigs: {
      async list(query) {
        authConfigCalls.push(query);
        return {
          items: authConfigs.filter((item) => !query.toolkit || item.toolkit === query.toolkit),
        };
      },
    },
    connectedAccounts: {
      async list(query) {
        listCalls.push(query);
        const userIds = query.userIds ?? [];
        return {
          items: accounts
            .filter((account) => userIds.includes(account.userId))
            .filter(
              (account) =>
                !query.toolkitSlugs || query.toolkitSlugs.includes(account.toolkit?.slug ?? ""),
            )
            .map((account) => ({
              id: account.id,
              status: account.status,
              toolkit: account.toolkit,
              updatedAt: account.updatedAt,
              // Provider payloads carry credentials. Nothing downstream may.
              state: { access_token: "ya29.dummy", refresh_token: "1//dummy" },
            })),
        };
      },
      async link(userId, authConfigId, options) {
        linked.push({ userId, authConfigId, callbackUrl: options?.callbackUrl });
        return { id: "ca_new", redirectUrl: "https://backend.composio.dev/redirect/ca_new" };
      },
      async delete(id) {
        deleted.push(id);
        return {};
      },
    },
  };

  return { client, listCalls, authConfigCalls, linked, deleted };
}

test("listing is filtered by the caller's own entity and covers both toolkits", async () => {
  const composio = createDummyComposio();
  const connections = await listComposioConnections(composio.client, "alice");

  assert.deepEqual(composio.listCalls[0].userIds, ["alice"]);
  assert.deepEqual(composio.listCalls[0].toolkitSlugs, ["gmail", "googlecalendar"]);
  assert.deepEqual(
    connections.map((entry) => [entry.toolkit, entry.status, entry.connectionId]),
    [
      ["gmail", "connected", "ca_alice_gmail"],
      ["googlecalendar", "disconnected", "ca_alice_calendar_dead"],
    ],
  );
});

test("one user never sees another user's connection", async () => {
  const composio = createDummyComposio();
  const alice = await listComposioConnections(composio.client, "alice");
  const bob = await listComposioConnections(composio.client, "bob");

  assert.equal(alice[0].connectionId, "ca_alice_gmail");
  assert.equal(bob[0].connectionId, "ca_bob_gmail");
  assert.ok(
    composio.listCalls.every((call) => call.userIds?.length === 1),
    "no listing may be made without exactly one entity filter",
  );
});

test("only the exactly named, enabled auth config is resolved", async () => {
  const composio = createDummyComposio();

  assert.equal(await resolveComposioAuthConfigId(composio.client, "gmail"), "ac_gmail");
  assert.equal(await resolveComposioAuthConfigId(composio.client, "googlecalendar"), "ac_calendar");
  assert.deepEqual(
    composio.authConfigCalls.map((call) => [call.toolkit, call.search]),
    [
      ["gmail", "cardea-gmail"],
      ["googlecalendar", "cardea-calendar"],
    ],
  );
});

test("a missing named auth config stops the connect instead of falling back", async () => {
  const composio = createDummyComposio();
  const empty: ComposioConnectionsClient = {
    ...composio.client,
    authConfigs: { async list() { return { items: [] }; } },
  };

  const result = await startComposioConnection(empty, {
    entityId: "alice",
    toolkit: "googlecalendar",
    callbackUrl: CALLBACK_URL,
  });

  assert.equal(result.outcome, "auth_config_missing");
  assert.equal(composio.linked.length, 0);
});

test("a connect links the session's own entity to the named auth config", async () => {
  const composio = createDummyComposio();
  const result = await startComposioConnection(composio.client, {
    entityId: "alice",
    toolkit: "googlecalendar",
    callbackUrl: CALLBACK_URL,
  });

  assert.equal(result.outcome, "redirect");
  assert.deepEqual(composio.linked, [
    { userId: "alice", authConfigId: "ac_calendar", callbackUrl: CALLBACK_URL },
  ]);
});

test("a repeat connect returns the existing account instead of erroring", async () => {
  const composio = createDummyComposio();
  const result = await startComposioConnection(composio.client, {
    entityId: "alice",
    toolkit: "gmail",
    callbackUrl: CALLBACK_URL,
  });

  assert.equal(result.outcome, "already_connected");
  assert.equal(
    result.outcome === "already_connected" ? result.connection.connectionId : null,
    "ca_alice_gmail",
  );
  assert.equal(composio.linked.length, 0, "an already-connected toolkit must not start a new link");
});

test("disconnecting another user's connection id is a miss, and deletes nothing", async () => {
  const composio = createDummyComposio();
  const result = await disconnectComposioConnection(composio.client, {
    entityId: "alice",
    connectionId: "ca_bob_gmail",
  });

  assert.equal(result.outcome, "not_found");
  assert.deepEqual(composio.deleted, []);
});

test("disconnecting an unknown id is indistinguishable from a foreign one", async () => {
  const composio = createDummyComposio();
  const result = await disconnectComposioConnection(composio.client, {
    entityId: "alice",
    connectionId: "ca_does_not_exist",
  });

  assert.equal(result.outcome, "not_found");
  assert.deepEqual(composio.deleted, []);
});

test("disconnecting the caller's own connection deletes exactly that one", async () => {
  const composio = createDummyComposio();
  const result = await disconnectComposioConnection(composio.client, {
    entityId: "alice",
    connectionId: "ca_alice_gmail",
  });

  assert.equal(result.outcome, "disconnected");
  assert.deepEqual(composio.deleted, ["ca_alice_gmail"]);
});

test("credential fields in a provider payload never survive into a result", async () => {
  const composio = createDummyComposio();
  const raw = await composio.client.connectedAccounts.list({ userIds: ["alice"] });
  assert.ok(
    JSON.stringify(raw).includes("ya29.dummy"),
    "the dummy must actually carry a credential, or this test proves nothing",
  );

  const connections = await listComposioConnections(composio.client, "alice");
  const started = await startComposioConnection(composio.client, {
    entityId: "alice",
    toolkit: "googlecalendar",
    callbackUrl: CALLBACK_URL,
  });

  for (const payload of [connections, started]) {
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("ya29.dummy"));
    assert.ok(!serialized.includes("1//dummy"));
    for (const key of serialized.match(/"([^"]+)":/g) ?? []) {
      assert.ok(
        !SECRET_FIELD_PATTERN.test(key),
        `${key} looks like a credential and must never be serialized`,
      );
    }
  }
});
