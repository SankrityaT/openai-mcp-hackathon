import assert from "node:assert/strict";
import test from "node:test";
import { composeApprovalEmail, sendApprovalEmail } from "./approval-email";

// No test here makes a network call. `fetch` is replaced per test and always
// restored, so a regression that reaches Resend fails loudly instead of
// quietly sending mail from CI.
type FetchCall = { url: string; init: RequestInit };

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function forbidFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("no network call is allowed here");
  }) as typeof globalThis.fetch;
  return {
    restore() {
      globalThis.fetch = original;
    },
  };
}

const DECISION = {
  recommendation: "Lyra found the apartment at $2,300 a month. Hold it?",
  consequence: "Holding costs a $200 deposit, refundable for 24 hours.",
  codename: "Lyra",
  boardUrl: "https://cardea.example/app",
};

test("composed message states the decision itself, never generic attention copy", () => {
  const { subject, text } = composeApprovalEmail(DECISION);

  assert.ok(subject.includes("Lyra found the apartment at $2,300 a month. Hold it?"));
  assert.ok(text.includes(DECISION.recommendation), "the body must carry the recommendation");
  assert.ok(text.includes(DECISION.consequence), "the body must carry the consequence");
  assert.ok(text.includes("Approve or modify on the board."));
  assert.ok(text.includes("https://cardea.example/app"));
  // DESIGN.md forbids this phrasing outright.
  assert.ok(!subject.toLowerCase().includes("needs attention"));
  assert.ok(!text.toLowerCase().includes("needs attention"));
});

test("composed body orders the decision, then its consequence, then where to act", () => {
  const lines = composeApprovalEmail(DECISION).text.split("\n");
  assert.deepEqual(lines, [
    DECISION.recommendation,
    DECISION.consequence,
    "Approve or modify on the board.",
    "https://cardea.example/app",
  ]);
});

test("an overlong recommendation is bounded rather than truncating the rest of the message", () => {
  const { subject, text } = composeApprovalEmail({
    ...DECISION,
    recommendation: "Book the flight ".repeat(60),
  });
  const lines = text.split("\n");
  assert.ok(lines[0].length <= 200);
  assert.ok(subject.length <= 120);
  assert.ok(text.includes(DECISION.consequence), "the consequence survives a long recommendation");
  assert.ok(text.includes("Approve or modify on the board."));
});

test("an approval with no recommendation still names the agent that stopped", () => {
  const { text } = composeApprovalEmail({ ...DECISION, recommendation: "   " });
  assert.ok(text.startsWith("Lyra is waiting on a decision."));
});

test("sendApprovalEmail reports not_configured and makes no network call without RESEND_API_KEY", async () => {
  delete process.env.RESEND_API_KEY;
  const guard = forbidFetch();
  try {
    const result = await sendApprovalEmail("someone@example.com", composeApprovalEmail(DECISION));
    assert.deepEqual(result, { sent: false, reason: "not_configured" });
  } finally {
    guard.restore();
  }
});

test("sendApprovalEmail posts plain text to Resend and reports the send", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  const stub = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const result = await sendApprovalEmail("someone@example.com", composeApprovalEmail(DECISION));
    assert.deepEqual(result, { sent: true });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "https://api.resend.com/emails");
    const body = JSON.parse(String(stub.calls[0].init.body));
    assert.deepEqual(body.to, ["someone@example.com"]);
    assert.ok(body.text.includes(DECISION.recommendation));
    assert.equal(body.html, undefined, "the message is plain text only");
  } finally {
    stub.restore();
    delete process.env.RESEND_API_KEY;
  }
});

test("sendApprovalEmail retries a transport failure exactly once, then reports failure", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  const stub = stubFetch(() => {
    throw new Error("connection reset");
  });
  try {
    const result = await sendApprovalEmail("someone@example.com", composeApprovalEmail(DECISION));
    assert.deepEqual(result, { sent: false, reason: "failed" });
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
    delete process.env.RESEND_API_KEY;
  }
});

test("sendApprovalEmail does not retry a permanent refusal", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  const stub = stubFetch(() => new Response("{}", { status: 403 }));
  try {
    const result = await sendApprovalEmail("someone@example.com", composeApprovalEmail(DECISION));
    assert.deepEqual(result, { sent: false, reason: "failed" });
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
    delete process.env.RESEND_API_KEY;
  }
});

test("sendApprovalEmail refuses an implausible address without calling the provider", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  const guard = forbidFetch();
  try {
    const result = await sendApprovalEmail("not-an-address", composeApprovalEmail(DECISION));
    assert.deepEqual(result, { sent: false, reason: "invalid_input" });
  } finally {
    guard.restore();
    delete process.env.RESEND_API_KEY;
  }
});
