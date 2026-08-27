import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalEmailResult } from "../core/server/approval-email";
import {
  approvalBoardUrl,
  notifyApprovalRequested,
  type ApprovalNotificationDeps,
} from "./approval-notification";

const APPROVAL = {
  approvalId: "approval-1",
  missionId: "mission-1",
  tenantId: "tenant-1",
  recommendation: "Lyra found the apartment at $2,300 a month. Hold it?",
  consequence: "Holding costs a $200 deposit, refundable for 24 hours.",
  category: "commit",
  codename: "Lyra",
};

type Recorder = {
  deps: ApprovalNotificationDeps;
  sent: { to: string; subject: string; text: string }[];
  addressLookups: number;
};

function recorder(overrides: Partial<ApprovalNotificationDeps> = {}): Recorder {
  const sent: Recorder["sent"] = [];
  const state = { addressLookups: 0 };
  const deps: ApprovalNotificationDeps = {
    resolveOwnerUserId: async () => "user-1",
    isEmailChannelEnabled: async () => true,
    resolveOwnerEmail: async () => {
      state.addressLookups += 1;
      return "owner@example.com";
    },
    send: async (to, content): Promise<ApprovalEmailResult> => {
      sent.push({ to, ...content });
      return { sent: true };
    },
    appOrigin: "https://cardea.example",
    ...overrides,
  };
  return {
    deps,
    sent,
    get addressLookups() {
      return state.addressLookups;
    },
  };
}

test("a guest or judge tenant has no owner, so the notifier exits quietly", async () => {
  const record = recorder({ resolveOwnerUserId: async () => null });
  const outcome = await notifyApprovalRequested(APPROVAL, record.deps);

  assert.deepEqual(outcome, { status: "no_owner" });
  assert.equal(record.sent.length, 0);
  assert.equal(record.addressLookups, 0, "an ownerless tenant must not trigger an address lookup");
});

test("an owner who never opted in is not emailed", async () => {
  const record = recorder({ isEmailChannelEnabled: async () => false });
  const outcome = await notifyApprovalRequested(APPROVAL, record.deps);

  assert.deepEqual(outcome, { status: "channel_disabled" });
  assert.equal(record.sent.length, 0);
  assert.equal(record.addressLookups, 0);
});

test("an owner with no address on the account is not emailed", async () => {
  const record = recorder({ resolveOwnerEmail: async () => null });
  const outcome = await notifyApprovalRequested(APPROVAL, record.deps);

  assert.deepEqual(outcome, { status: "no_address" });
  assert.equal(record.sent.length, 0);
});

test("an opted-in owner is told the decision itself, with an absolute board link", async () => {
  const record = recorder();
  const outcome = await notifyApprovalRequested(APPROVAL, record.deps);

  assert.deepEqual(outcome, { status: "sent" });
  assert.equal(record.sent.length, 1);
  const message = record.sent[0];
  assert.equal(message.to, "owner@example.com");
  assert.ok(message.subject.includes("Hold it?"));
  assert.ok(message.text.includes(APPROVAL.recommendation));
  assert.ok(message.text.includes(APPROVAL.consequence));
  assert.ok(message.text.includes("https://cardea.example/app"));
  assert.ok(!message.text.toLowerCase().includes("needs attention"));
});

test("an unconfigured transport is a reported outcome, not a thrown error", async () => {
  const record = recorder({ send: async () => ({ sent: false, reason: "not_configured" }) });
  const outcome = await notifyApprovalRequested(APPROVAL, record.deps);
  assert.deepEqual(outcome, { status: "not_sent", reason: "not_configured" });
});

test("board link is omitted rather than relative when the app origin is unset", () => {
  assert.equal(approvalBoardUrl(""), "");
  assert.equal(approvalBoardUrl("/app"), "");
  assert.equal(approvalBoardUrl("https://cardea.example/"), "https://cardea.example/app");
});
