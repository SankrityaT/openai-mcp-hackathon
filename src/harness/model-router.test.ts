import assert from "node:assert/strict";
import test from "node:test";
import { routeModel } from "./model-router";

test("routes routine work to Terra", () => {
  assert.equal(routeModel().modelId, "gpt-5.6-terra");
  assert.equal(
    routeModel({
      validationFailures: 0,
      dependencyDepth: 2,
      conflictingConstraints: 0,
      riskLevel: "medium",
      toolFailures: 0,
    }).modelId,
    "gpt-5.6-terra",
  );
});

test("escalates bounded hard cases to Sol", () => {
  assert.equal(
    routeModel({
      validationFailures: 2,
      dependencyDepth: 2,
      conflictingConstraints: 0,
      riskLevel: "medium",
      toolFailures: 0,
    }).modelId,
    "gpt-5.6-sol",
  );
});
