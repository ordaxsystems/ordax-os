import assert from "node:assert/strict";
import test from "node:test";

import { createActionPolicyEngine } from "../system/services/action-policy/policy-engine.mjs";

function request(overrides = {}) {
  return {
    workItemId: "work-1",
    approvalId: "approval-1",
    actionId: "files.write",
    toolId: "files",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: "file-space:/Docs/a.md",
    reason: "Update the project document.",
    requestedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

const now = () => Date.parse("2026-10-03T12:01:00.000Z");

test("Action Policy defaults to authority-free continuation", () => {
  const verdict = createActionPolicyEngine({ now }).evaluate(request());
  assert.equal(verdict.outcome, "allow-if-authorized");
  assert.equal(verdict.authority, "none");
  assert.deepEqual(verdict.matchedRuleIds, []);
});

test("most restrictive matching rule wins over lower permissive preferences", () => {
  const engine = createActionPolicyEngine({
    now,
    rules: [{
      id: "user-allow",
      layer: "user",
      outcome: "allow-if-authorized",
      actionId: "files.write",
      reason: "User preference permits this only if separately authorized.",
    }, {
      id: "core-deny",
      layer: "core-security",
      outcome: "deny",
      effect: "write",
      resourceScheme: "file-space",
      reason: "Core policy blocks this class of write.",
    }],
  });

  const verdict = engine.evaluate(request());
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.authority, "none");
  assert.deepEqual(verdict.matchedRuleIds, ["user-allow", "core-deny"]);
});

test("approval and handoff rules can only reduce automation", () => {
  const engine = createActionPolicyEngine({
    now,
    rules: [{
      id: "device-ask",
      layer: "device",
      outcome: "approval-required",
      effect: "write",
      reason: "Writes require explicit approval on this device.",
    }, {
      id: "work-handoff",
      layer: "work",
      outcome: "handoff-to-user",
      actionId: "files.write",
      reason: "This Work requires the user to perform the operation manually.",
    }],
  });

  const verdict = engine.evaluate(request());
  assert.equal(verdict.outcome, "handoff-to-user");
  assert.equal(verdict.authority, "none");
});

test("policy rules remain bound to owner and context", () => {
  const engine = createActionPolicyEngine({
    now,
    rules: [{
      id: "other-owner",
      layer: "user",
      outcome: "deny",
      ownerKind: "account",
      ownerId: "user-2",
      reason: "Only applies to another account.",
    }],
  });

  assert.equal(engine.evaluate(request()).outcome, "allow-if-authorized");
});

test("duplicate ids and malformed account scope fail closed", () => {
  assert.throws(
    () => createActionPolicyEngine({
      rules: [{ id: "x", layer: "user", outcome: "deny", reason: "one" }, {
        id: "x",
        layer: "device",
        outcome: "deny",
        reason: "two",
      }],
    }),
    /unique/,
  );

  assert.throws(
    () => createActionPolicyEngine({
      rules: [{
        id: "account-rule",
        layer: "user",
        outcome: "deny",
        ownerKind: "account",
        reason: "Missing exact account owner.",
      }],
    }),
    /owner id/,
  );
});
