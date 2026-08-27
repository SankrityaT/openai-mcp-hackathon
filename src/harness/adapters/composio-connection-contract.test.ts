import assert from "node:assert/strict";
import test from "node:test";
import {
  authConfigNameForToolkit,
  COMPOSIO_AUTH_CONFIG_NAMES,
  COMPOSIO_CONNECTION_TOOLKITS,
  findOwnedConnection,
  isComposioConnectionToolkit,
  toConnectionStatus,
  toPublicConnection,
  toPublicConnectionList,
} from "./composio-connection-contract";

/** Any field name that would betray a credential if it ever reached a client. */
const SECRET_FIELD_PATTERN = /token|secret|refresh|access_key/i;

function assertNoSecretFields(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assert.ok(
        !SECRET_FIELD_PATTERN.test(key),
        `${path}.${key} looks like a credential and must never be serialized`,
      );
      assertNoSecretFields(entry, `${path}.${key}`);
    }
  }
}

test("only Gmail and Google Calendar are offered, each bound to its named auth config", () => {
  assert.deepEqual([...COMPOSIO_CONNECTION_TOOLKITS], ["gmail", "googlecalendar"]);
  assert.equal(authConfigNameForToolkit("gmail"), "cardea-gmail");
  assert.equal(authConfigNameForToolkit("googlecalendar"), "cardea-calendar");
  assert.deepEqual(Object.values(COMPOSIO_AUTH_CONFIG_NAMES).sort(), [
    "cardea-calendar",
    "cardea-gmail",
  ]);
});

test("an unknown toolkit is rejected rather than passed through to the provider", () => {
  assert.equal(isComposioConnectionToolkit("gmail"), true);
  assert.equal(isComposioConnectionToolkit("googledrive"), false);
  assert.equal(isComposioConnectionToolkit("GMAIL"), false);
  assert.equal(isComposioConnectionToolkit(null), false);
  assert.equal(isComposioConnectionToolkit({ toString: () => "gmail" }), false);
});

test("provider statuses collapse to the four states a person is shown", () => {
  assert.equal(toConnectionStatus("ACTIVE"), "connected");
  assert.equal(toConnectionStatus("INITIATED"), "pending");
  assert.equal(toConnectionStatus("INITIALIZING"), "pending");
  assert.equal(toConnectionStatus("FAILED"), "error");
  assert.equal(toConnectionStatus("EXPIRED"), "error");
  assert.equal(toConnectionStatus("REVOKED"), "disconnected");
  assert.equal(toConnectionStatus("INACTIVE"), "disconnected");
  // A status this SDK version does not know must read as "not connected"
  // rather than as an unexplained new state.
  assert.equal(toConnectionStatus("SOMETHING_NEW"), "disconnected");
  assert.equal(toConnectionStatus(null), "disconnected");
});

test("the public connection shape drops every credential-bearing provider field", () => {
  const raw = {
    id: "ca_abc123",
    status: "ACTIVE",
    toolkit: { slug: "gmail" },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    // Everything below is what the provider may carry and Cardea must not.
    state: { access_token: "ya29.secret", refresh_token: "1//secret" },
    data: { accessToken: "ya29.secret" },
    params: { client_secret: "shh" },
    authConfig: { id: "ac_1", credentials: { access_key: "nope" } },
  };

  const publicShape = toPublicConnection("gmail", raw);

  assert.deepEqual(Object.keys(publicShape).sort(), [
    "connectedAt",
    "connectionId",
    "label",
    "status",
    "toolkit",
  ]);
  assert.equal(publicShape.status, "connected");
  assert.equal(publicShape.connectionId, "ca_abc123");
  assert.equal(publicShape.label, "Gmail");
  assertNoSecretFields(publicShape);
  assert.ok(!JSON.stringify(publicShape).includes("ya29.secret"));
});

test("every offered toolkit appears once, disconnected when the user has no account", () => {
  const list = toPublicConnectionList([
    { id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } },
  ]);

  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((entry) => entry.toolkit),
    ["gmail", "googlecalendar"],
  );
  assert.equal(list[0].status, "connected");
  assert.equal(list[1].status, "disconnected");
  assert.equal(list[1].connectionId, null);
  assertNoSecretFields(list);
});

test("a live account outranks a stale record for the same toolkit", () => {
  const list = toPublicConnectionList([
    { id: "ca_old", status: "REVOKED", toolkit: { slug: "gmail" } },
    { id: "ca_new", status: "ACTIVE", toolkit: { slug: "gmail" } },
  ]);

  assert.equal(list[0].status, "connected");
  assert.equal(list[0].connectionId, "ca_new");
});

test("a connection id outside the caller's own listing is simply absent", () => {
  const own = [{ id: "ca_mine", status: "ACTIVE", toolkit: { slug: "gmail" } }];

  assert.equal(findOwnedConnection(own, "ca_mine")?.id, "ca_mine");
  assert.equal(findOwnedConnection(own, "ca_someone_else"), null);
  assert.equal(findOwnedConnection([], "ca_mine"), null);
});
