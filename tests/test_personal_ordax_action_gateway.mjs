import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_GATEWAY_SCHEMA } from "../system/contracts/action-gateway.mjs";
import { canExecutePersonalAction } from "../system/contracts/personal-ordax.mjs";
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

function gateway({ grants = [grant()], readPolicy = null } = {}) {
  const byGrant = new Map(grants.map((entry) => [entry.grantId, entry]));
  return createPersonalOrdaxActionGateway({
    toolResolver(toolId) {
      return toolId === "files-inspector" ? tool() : null;
    },
    grantResolver(grantId) {
      return byGrant.get(grantId) ?? null;
    },
    readPolicy,
    now: () => Date.parse("2026-09-30T21:00:00.000Z"),
  });
}

test("Action Gateway requires approval when no explicit sensitive grant exists", () => {
  const port = gateway();
  assert.equal(port.schema, ACTION_GATEWAY_SCHEMA);
  const value = port.decide(request());
  assert.equal(value.decision, "approval-required");
  assert.equal(value.authoritySource, "intelligence-tool-grant");
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
