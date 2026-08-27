import assert from "node:assert/strict";
import test from "node:test";
import { describeEventType, eventFamily } from "./activity-labels";

test("eventFamily groups node and dependency events under nodes", () => {
  assert.equal(eventFamily("node.started"), "nodes");
  assert.equal(eventFamily("node.completed"), "nodes");
  assert.equal(eventFamily("dependency.rerouted"), "nodes");
});

test("eventFamily groups tool and capability events under tools", () => {
  assert.equal(eventFamily("tool.completed"), "tools");
  assert.equal(eventFamily("capability.discovered"), "tools");
});

test("eventFamily groups evidence events under evidence", () => {
  assert.equal(eventFamily("evidence.recorded"), "evidence");
});

test("eventFamily groups approval and mandate events under approvals", () => {
  assert.equal(eventFamily("approval.requested"), "approvals");
  assert.equal(eventFamily("approval.resolved"), "approvals");
  assert.equal(eventFamily("mandate.revised"), "approvals");
});

test("eventFamily falls back to other for uncatalogued prefixes", () => {
  assert.equal(eventFamily("mission.created"), "other");
  assert.equal(eventFamily("memory.promoted"), "other");
  assert.equal(eventFamily("quota.consumed"), "other");
  assert.equal(eventFamily("unknown.thing"), "other");
});

test("describeEventType maps the catalogue to sentence-case labels", () => {
  assert.equal(describeEventType("node.started"), "Node started");
  assert.equal(describeEventType("tool.completed"), "Tool completed");
  assert.equal(describeEventType("evidence.recorded"), "Evidence recorded");
  assert.equal(describeEventType("approval.requested"), "Approval requested");
});

test("describeEventType falls back to the raw type for unknown values", () => {
  assert.equal(describeEventType("something.unlisted"), "something.unlisted");
});
