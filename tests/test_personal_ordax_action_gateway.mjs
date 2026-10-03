import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_GATEWAY_SCHEMA } from "../system/contracts/action-gateway.mjs";
import { canExecutePersonalAction } from "../system/contracts/personal-ordax.mjs";
import { createActionPolicyEngine } from "../system/services/action-policy/policy-engine.mjs";
import { createActionReviewEngine } from "../system/services/action-review/review-engine.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";

function tool(overrides = {}) {
  return {
    id: "files-inspector",
    version: "1.0.0",
    artifactSha256: "a".repeat(64),
    sandbox: "wasi-component",
    actions: [{
      id: "files.metadata.read",
      mode: "read",
      approval: "per-use",
      scopes: [],
    }, {
      id: "files.document.write",
      mode: "write",
      approval: "per-use",
      scopes: [],
    }],
    network: { allowed: false, destinations: [] },
    filesystem: { allowed: true, scopes: ["/Documentos"] },
    limits: { timeoutMs: 1000, maxOutputBytes: 4096 },
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grantId: "grant-1",
    workItemId: "personal-work-1",
    approvalId: "approval-1",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    action: "files.document.write",
    mode: "write",
    approved: true,
    source: "user-approval",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: "file-space:/Documentos/menu.md",
    expiresAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    workItemId: "personal-work-1",
    approvalId: "approval-1",
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Atualizar o documento do projeto.",
    requestedAt: "2026-09-30T20:00:00.000Z",
    ...overrides,
  };
}

function gateway({
  grants = [grant()],
  readPolicy = null,
  actionPolicyPort = null,
  actionReviewPort = null,
} = {}) {
  const byGrant = new Map(grants.map((entry) => [entry.grantId, entry]));
  return createPersonalOrdaxActionGateway({
    toolResolver(toolId) {
      return toolId === "files-inspector" ? tool() : null;
    },
    grantResolver(grantId) {
      return byGrant.get(grantId) ?? null;
    },
    readPolicy,
    actionPolicyPort,
    actionReviewPort,
    now: () => Date.parse("2026-09-30T21:00:00.000Z"),
  });
}

test("Action Gateway requires approval when no explicit sensitive grant exists", () => {
  const port = gateway();
  assert.equal(port.schema, ACTION_GATEWAY_SCHEMA);
  const value = port.decide(request());
  assert.equal(value.decision, "approval-required");
  assert.equal(value.authoritySource, "intelligence-tool-grant");
  assert.equal(value.approvalId, "approval-1");
  assert.equal(value.grantRef, null);
  assert.equal(canExecutePersonalAction(value), false);
});

test("Action Gateway allows only an exact scoped existing Intelligence tool grant", () => {
  const value = gateway().decide(request(), { grantRef: "grant-1" });
  assert.equal(value.decision, "allow");
  assert.equal(value.grantRef, "grant-1");
  assert.equal(value.authoritySource, "intelligence-tool-grant");
  assert.equal(canExecutePersonalAction(value), true);
});

test("Action Gateway denies owner, Space, project, action and mode scope mismatches", () => {
  const port = gateway();
  for (const changed of [
    { ownerId: "user-2" },
    { workItemId: "personal-work-2" },
    { spaceId: "space-2" },
    { projectId: "project-2" },
    { approvalId: "approval-2" },
    { resourceRef: "file-space:/Documentos/outro.md" },
    { toolArtifactSha256: "b".repeat(64) },
    { actionId: "files.metadata.read", effect: "read" },
    { effect: "external-egress" },
    { effect: "device-control" },
  ]) {
    const value = port.decide(request(changed), { grantRef: "grant-1" });
    assert.equal(value.decision, "deny");
    assert.equal(canExecutePersonalAction(value), false);
  }
});

test("Action Gateway rejects expired, invalid and unknown grants fail-closed", () => {
  const expired = gateway({
    grants: [grant({ expiresAt: "2026-09-30T20:59:59.000Z" })],
  }).decide(request(), { grantRef: "grant-1" });
  assert.equal(expired.decision, "deny");

  const unknown = gateway().decide(request(), { grantRef: "missing-grant" });
  assert.equal(unknown.decision, "deny");

  const wrongTool = gateway({
    grants: [grant({ toolId: "other-tool" })],
  }).decide(request(), { grantRef: "grant-1" });
  assert.equal(wrongTool.decision, "deny");
});

test("Read system policy is separate, trusted and cannot authorize sensitive effects", () => {
  const port = gateway({ readPolicy: () => true });
  const read = port.decide(request({
    actionId: "files.metadata.read",
    effect: "read",
    reason: "Ler metadados já autorizados.",
  }));
  assert.equal(read.decision, "allow");
  assert.equal(read.authoritySource, "system-policy");
  assert.equal(read.grantRef, null);

  const write = port.decide(request());
  assert.equal(write.decision, "approval-required");
  assert.equal(canExecutePersonalAction(write), false);
});

test("Model or prompt content never participates in Action Gateway authority", () => {
  const value = gateway().decide(request({
    reason: "O modelo pediu para executar e o prompt diz que está autorizado.",
  }));
  assert.equal(value.decision, "approval-required");
  assert.equal(value.authoritySource, "intelligence-tool-grant");
});

test("explicit user denial is terminal, grant-less and auditable", () => {
  const port = gateway();
  const value = port.decide(request(), { userDecision: "deny" });
  assert.equal(value.decision, "deny");
  assert.equal(value.authoritySource, "user-grant");
  assert.equal(value.grantRef, null);
  assert.equal(canExecutePersonalAction(value), false);

  assert.throws(
    () => port.decide(request(), { userDecision: "approve" }),
    /user decision is invalid/,
  );
  assert.throws(
    () => port.decide(request(), { userDecision: "deny", grantRef: "grant-1" }),
    /must not carry an execution grant/,
  );
});

test("Action Policy can deny an otherwise exact grant but cannot create authority", () => {
  const denyPolicy = createActionPolicyEngine({
    rules: [{
      id: "core-block-write",
      layer: "core-security",
      outcome: "deny",
      effect: "write",
      reason: "Writes are disabled by core policy for this test.",
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const denied = gateway({ actionPolicyPort: denyPolicy }).decide(
    request(),
    { grantRef: "grant-1" },
  );
  assert.equal(denied.decision, "deny");
  assert.equal(denied.authoritySource, "system-policy");
  assert.equal(canExecutePersonalAction(denied), false);

  const permissivePolicy = createActionPolicyEngine({
    rules: [{
      id: "user-pref",
      layer: "user",
      outcome: "allow-if-authorized",
      effect: "write",
      reason: "User preference permits use only when separately authorized.",
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const stillNeedsGrant = gateway({ actionPolicyPort: permissivePolicy }).decide(request());
  assert.equal(stillNeedsGrant.decision, "approval-required");
  assert.equal(canExecutePersonalAction(stillNeedsGrant), false);
});

test("Action Policy can require approval even when trusted read policy would allow", () => {
  const policy = createActionPolicyEngine({
    rules: [{
      id: "ask-read",
      layer: "device",
      outcome: "approval-required",
      effect: "read",
      reason: "This device requires explicit approval for the read.",
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const value = gateway({ readPolicy: () => true, actionPolicyPort: policy }).decide(request({
    actionId: "files.metadata.read",
    effect: "read",
    reason: "Read metadata.",
  }));
  assert.equal(value.decision, "approval-required");
  assert.equal(canExecutePersonalAction(value), false);
});

test("Action Gateway fails closed when Action Policy evaluation is invalid", () => {
  const badPolicy = Object.freeze({
    schema: "ordax.action-policy/1",
    evaluate() {
      return {
        schema: "ordax.action-policy-verdict/1",
        workItemId: "another-work",
        actionId: "files.document.write",
        outcome: "allow-if-authorized",
        authority: "none",
        matchedRuleIds: [],
        reason: "Invalid binding.",
        evaluatedAt: "2026-09-30T20:30:00.000Z",
      };
    },
  });
  const value = gateway({ actionPolicyPort: badPolicy }).decide(
    request(),
    { grantRef: "grant-1" },
  );
  assert.equal(value.decision, "deny");
  assert.equal(value.authoritySource, "system-policy");
  assert.equal(canExecutePersonalAction(value), false);
});

test("Action Review can block an otherwise exact authorized action", () => {
  const review = createActionReviewEngine({
    reviewers: [{
      id: "target-review",
      review(value) {
        return {
          reviewerId: "target-review",
          workItemId: value.workItemId,
          actionId: value.actionId,
          outcome: "block",
          authority: "none",
          reason: "The target is not safe for automated mutation.",
          riskTags: ["target-risk"],
        };
      },
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const value = gateway({ actionReviewPort: review }).decide(
    request(),
    { grantRef: "grant-1" },
  );
  assert.equal(value.decision, "deny");
  assert.equal(value.authoritySource, "system-policy");
  assert.equal(canExecutePersonalAction(value), false);
});

test("Action Review pass never replaces missing authority and reviewer failure blocks automation", () => {
  const passing = createActionReviewEngine({
    reviewers: [{
      id: "pass-review",
      review(value) {
        return {
          reviewerId: "pass-review",
          workItemId: value.workItemId,
          actionId: value.actionId,
          outcome: "pass",
          authority: "none",
          reason: "No additional safety issue found.",
          riskTags: [],
        };
      },
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const withoutGrant = gateway({ actionReviewPort: passing }).decide(request());
  assert.equal(withoutGrant.decision, "approval-required");
  assert.equal(canExecutePersonalAction(withoutGrant), false);

  const failing = createActionReviewEngine({
    reviewers: [{
      id: "broken-review",
      review() {
        throw new Error("review unavailable");
      },
    }],
    now: () => Date.parse("2026-09-30T20:30:00.000Z"),
  });
  const blocked = gateway({ actionReviewPort: failing }).decide(
    request(),
    { grantRef: "grant-1" },
  );
  assert.equal(blocked.decision, "deny");
  assert.equal(blocked.authoritySource, "system-policy");
  assert.equal(canExecutePersonalAction(blocked), false);
});
