import assert from "node:assert/strict";
import test from "node:test";
import {
  CardeaMissionHttpClient,
  MissionHttpError,
  type FetchLike,
} from "./mission-http-client";
import { DEFAULT_MISSION_AUTHORITY } from "./mission-data-source";

type Recorded = { url: string; method?: string; body?: string; credentials?: string };

function fakeFetch(
  handler: (recorded: Recorded) => { status?: number; body?: unknown; text?: string },
) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const recorded: Recorded = {
      url,
      method: init?.method,
      body: init?.body,
      credentials: init?.credentials,
    };
    calls.push(recorded);
    const result = handler(recorded);
    const text = result.text ?? (result.body === undefined ? "" : JSON.stringify(result.body));
    return new Response(text, { status: result.status ?? 200 });
  };
  return { fetchImpl, calls };
}

const snapshot = {
  mission: {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    title: "Bounded goal",
    status: "draft",
    mandateVersion: 1,
    rootNodeId: null,
    lastEventSequence: 1,
    stateVersion: 1,
    budgetLimits: {},
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  },
  mandate: {},
  nodes: [],
  edges: [],
  pendingApprovals: [],
  latestSequence: 1,
};

test("session state defaults conservatively", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { authenticated: false } }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  const session = await client.getSession();

  assert.deepEqual(session, {
    authenticated: false,
    configured: true,
    userId: null,
    guest: false,
    judge: false,
  });
  assert.equal(calls[0]?.url, "/api/session");
  assert.equal(calls[0]?.credentials, "same-origin");
});

test("an unconfigured deployment is reported as unconfigured", async () => {
  const { fetchImpl } = fakeFetch(() => ({
    body: { authenticated: false, configured: false, guest: true, judge: false },
  }));
  const session = await new CardeaMissionHttpClient({ fetchImpl }).getSession();
  assert.equal(session.configured, false);
  assert.equal(session.guest, true);
});

test("mission creation posts a bounded body and returns the snapshot", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: snapshot }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  const created = await client.createMission({
    title: "Bounded goal",
    goal: "Bounded goal",
    constraints: [],
    authority: DEFAULT_MISSION_AUTHORITY,
    selectedContextCardIds: [],
    budgetLimits: {},
  });

  assert.equal(created.mission.id, snapshot.mission.id);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/api/missions");
  const sent = JSON.parse(calls[0]?.body ?? "{}") as { authority: { freePassage: boolean } };
  assert.equal(sent.authority.freePassage, false);
});

test("a missing mission is null rather than an error", async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 404, body: { error: "not_found" } }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  assert.equal(await client.getMission("11111111-1111-4111-8111-111111111111"), null);
});

test("events are requested after a sanitised sequence and bounded on return", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { events: [{ sequence: 2 }] } }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  const events = await client.listEvents("11111111-1111-4111-8111-111111111111", -5);
  assert.equal(events.length, 1);
  assert.match(calls[0]?.url ?? "", /\/events\?after=0$/);
});

test("a quota denial is surfaced as a typed denial", async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 429,
    body: {
      error: "quota_denied",
      code: "quota_exhausted",
      scope: "guest",
      metric: "mission.created",
      limit: 1,
      used: 1,
    },
  }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  await assert.rejects(
    () =>
      client.createMission({
        title: "Bounded goal",
        goal: "Bounded goal",
        constraints: [],
        authority: DEFAULT_MISSION_AUTHORITY,
        selectedContextCardIds: [],
        budgetLimits: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof MissionHttpError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "quota_denied");
      assert.equal(error.denial?.scope, "guest");
      return true;
    },
  );
});

test("an authentication failure keeps its redacted code", async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 401,
    body: { error: "authentication_required" },
  }));
  const client = new CardeaMissionHttpClient({ fetchImpl });
  await assert.rejects(
    () => client.listEvents("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof MissionHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "authentication_required");
      assert.equal(error.denial, null);
      return true;
    },
  );
});

test("oversized responses are refused instead of parsed", async () => {
  const { fetchImpl } = fakeFetch(() => ({ text: "x".repeat(2_048) }));
  const client = new CardeaMissionHttpClient({ fetchImpl, maxResponseBytes: 1_024 });
  await assert.rejects(
    () => client.getSession(),
    (error: unknown) => {
      assert.ok(error instanceof MissionHttpError);
      assert.equal(error.code, "response_too_large");
      return true;
    },
  );
});

test("oversized requests never leave the client", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: snapshot }));
  const client = new CardeaMissionHttpClient({ fetchImpl, maxRequestBytes: 64 });
  await assert.rejects(
    () =>
      client.createMission({
        title: "Bounded goal",
        goal: "g".repeat(500),
        constraints: [],
        authority: DEFAULT_MISSION_AUTHORITY,
        selectedContextCardIds: [],
        budgetLimits: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof MissionHttpError);
      assert.equal(error.code, "request_too_large");
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("a transport failure is redacted to a network error", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("connection refused to 10.0.0.5");
  };
  const client = new CardeaMissionHttpClient({ fetchImpl });
  await assert.rejects(
    () => client.getSession(),
    (error: unknown) => {
      assert.ok(error instanceof MissionHttpError);
      assert.equal(error.code, "network_error");
      assert.doesNotMatch(error.message, /10\.0\.0\.5/);
      return true;
    },
  );
});
