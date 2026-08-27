import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConnectCommand,
  buildConnectionCallbackUrl,
  buildDisconnectCommand,
  resolveConnectionEntity,
  type ConnectionPrincipal,
} from "./connect-request";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const NON_USERS: ConnectionPrincipal[] = [
  { kind: "anonymous" },
  { kind: "judge" },
  { kind: "guest" },
];

test("only a signed-in Supabase user resolves to a Composio entity", () => {
  const allowed = resolveConnectionEntity({ kind: "user", userId: ALICE });
  assert.deepEqual(allowed, { ok: true, entityId: ALICE });

  for (const principal of NON_USERS) {
    const result = resolveConnectionEntity(principal);
    assert.equal(result.ok, false, `${principal.kind} must not reach a connect endpoint`);
    assert.equal(result.ok === false && result.rejection.status, 401);
    assert.equal(result.ok === false && result.rejection.error, "authentication_required");
  }
});

test("anonymous, judge, and guest principals are refused before any body is read", () => {
  for (const principal of NON_USERS) {
    const connect = buildConnectCommand(principal, { toolkit: "gmail" });
    assert.equal(connect.ok === false && connect.rejection.status, 401);

    const disconnect = buildDisconnectCommand(principal, "ca_abc123");
    assert.equal(disconnect.ok === false && disconnect.rejection.status, 401);
  }
});

test("a signed-in user connecting a known toolkit is accepted", () => {
  const result = buildConnectCommand({ kind: "user", userId: ALICE }, { toolkit: "googlecalendar" });
  assert.deepEqual(result, {
    ok: true,
    command: { entityId: ALICE, toolkit: "googlecalendar" },
  });
});

test("the entity always comes from the session, never from the request body", () => {
  const forged = buildConnectCommand({ kind: "user", userId: ALICE }, {
    toolkit: "gmail",
    // Every shape someone might try to smuggle another identity through.
    userId: BOB,
    entityId: BOB,
    user_id: BOB,
    connectionId: "ca_bob_gmail",
    connectedAccountId: "ca_bob_gmail",
    authConfigId: "ac_someone_else",
  });

  assert.equal(forged.ok, true);
  assert.equal(forged.ok && forged.command.entityId, ALICE);
  assert.deepEqual(
    forged.ok && Object.keys(forged.command).sort(),
    ["entityId", "toolkit"],
    "the command carries nothing a caller could have supplied beyond the toolkit",
  );
  assert.ok(!JSON.stringify(forged).includes(BOB));
});

test("a disconnect binds the caller's own entity to the path id", () => {
  const result = buildDisconnectCommand({ kind: "user", userId: ALICE }, "ca_abc123");
  assert.deepEqual(result, {
    ok: true,
    command: { entityId: ALICE, connectionId: "ca_abc123" },
  });
});

test("an unknown toolkit never reaches the provider", () => {
  for (const toolkit of ["googledrive", "GMAIL", "", null, 42, { slug: "gmail" }]) {
    const result = buildConnectCommand({ kind: "user", userId: ALICE }, { toolkit });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection.status, 400);
  }
});

test("a body that is not an object is refused", () => {
  for (const body of [null, undefined, "gmail", 7, ["gmail"]]) {
    const result = buildConnectCommand({ kind: "user", userId: ALICE }, body);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection.status, 400);
  }
});

test("a malformed or oversized connection id fails as not found, never as forbidden", () => {
  const principal: ConnectionPrincipal = { kind: "user", userId: ALICE };
  for (const id of ["", "ca abc", "../../etc/passwd", "ca_%41", "x".repeat(121), null, 7, {}]) {
    const result = buildDisconnectCommand(principal, id);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection.status, 404);
    assert.equal(result.ok === false && result.rejection.error, "not_found");
  }
});

test("rejections never carry a hint beyond their status", () => {
  const rejections = [
    buildConnectCommand({ kind: "guest" }, { toolkit: "gmail" }),
    buildConnectCommand({ kind: "user", userId: ALICE }, { toolkit: "googledrive" }),
    buildDisconnectCommand({ kind: "user", userId: ALICE }, "ca abc"),
  ];

  for (const rejection of rejections) {
    assert.equal(rejection.ok, false);
    assert.deepEqual(
      rejection.ok === false && Object.keys(rejection.rejection).sort(),
      ["error", "status"],
    );
  }
});

test("the OAuth return address is always Cardea's own settings page", () => {
  assert.equal(
    buildConnectionCallbackUrl("https://cardea.example", "gmail"),
    "https://cardea.example/settings/integrations?toolkit=gmail",
  );
  assert.equal(
    buildConnectionCallbackUrl("http://localhost:3000", "googlecalendar"),
    "http://localhost:3000/settings/integrations?toolkit=googlecalendar",
  );
});
