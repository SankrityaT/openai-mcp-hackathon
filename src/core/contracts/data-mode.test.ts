import assert from "node:assert/strict";
import test from "node:test";
import {
  describeDataMode,
  parseDataModeSetting,
  resolveDataMode,
  type SessionProbe,
} from "./data-mode";

test("an absent or fixture setting requests fixture mode", () => {
  for (const value of [undefined, null, "", "  ", "fixture", "FIXTURE"]) {
    assert.deepEqual(parseDataModeSetting(value), {
      requestedMode: "fixture",
      invalid: false,
    });
  }
});

test("only an explicit live setting requests live mode", () => {
  assert.deepEqual(parseDataModeSetting("live"), { requestedMode: "live", invalid: false });
  assert.deepEqual(parseDataModeSetting(" Live "), { requestedMode: "live", invalid: false });
});

test("an unknown setting is invalid and never enables live mode", () => {
  const parsed = parseDataModeSetting("production");
  assert.equal(parsed.requestedMode, "fixture");
  assert.equal(parsed.invalid, true);

  const state = resolveDataMode({
    configuredValue: "production",
    session: { status: "authenticated", userId: "user-1" },
  });
  assert.equal(state.mode, "fixture");
  assert.equal(state.reason, "invalid_configuration");
  assert.equal(state.persistenceAvailable, false);
  assert.match(state.notice ?? "", /NEXT_PUBLIC_CARDEA_DATA_MODE/);
});

test("fixture mode never probes a session and carries no notice", () => {
  const state = resolveDataMode({
    configuredValue: "fixture",
    session: { status: "authenticated", userId: "user-1" },
  });
  assert.deepEqual(state, {
    mode: "fixture",
    requestedMode: "fixture",
    reason: "fixture_configured",
    notice: null,
    persistenceAvailable: false,
  });
});

test("live mode requires an authenticated session", () => {
  const state = resolveDataMode({
    configuredValue: "live",
    session: { status: "authenticated", userId: "user-1" },
  });
  assert.equal(state.mode, "live");
  assert.equal(state.reason, "live_configured");
  assert.equal(state.persistenceAvailable, true);
  assert.equal(state.notice, null);
  assert.equal(describeDataMode(state), "Live · persisted");
});

test("server-issued guest and judge sessions use the persisted live spine", () => {
  const guest = resolveDataMode({ configuredValue: "live", session: { status: "guest" } });
  const judge = resolveDataMode({ configuredValue: "live", session: { status: "judge" } });
  assert.equal(guest.mode, "live");
  assert.equal(guest.reason, "live_guest");
  assert.equal(judge.mode, "live");
  assert.equal(judge.reason, "live_judge");
  assert.equal(guest.persistenceAvailable, true);
  assert.equal(judge.persistenceAvailable, true);
});

test("live mode falls back truthfully for every non-authenticated session", () => {
  const cases: [SessionProbe, string][] = [
    [{ status: "pending" }, "live_session_pending"],
    [{ status: "anonymous" }, "live_requires_sign_in"],
    [{ status: "unavailable" }, "live_unavailable"],
  ];
  for (const [session, reason] of cases) {
    const state = resolveDataMode({ configuredValue: "live", session });
    assert.equal(state.mode, "fixture");
    assert.equal(state.requestedMode, "live");
    assert.equal(state.reason, reason);
    assert.equal(state.persistenceAvailable, false);
    assert.match(state.notice ?? "", /nothing is persisted/);
    assert.equal(describeDataMode(state), "Fixture · not persisted");
  }
});
