import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_TOOL_GRANT_SCHEMA,
  INTELLIGENCE_TOOL_SCHEMA,
  authorizeIntelligenceToolAction,
  defineIntelligenceTool,
  validateIntelligenceToolGrant,
} from "../system/contracts/intelligence-tool.mjs";

function tool(overrides = {}) {
  return {
    id: "files-inspector",
    version: "0.1.0",
    artifactSha256: "a".repeat(64),
    sandbox: "wasi-component",
    actions: [
      { id: "files.metadata.read", mode: "read", approval: "none", scopes: ["project"] },
      { id: "files.text.write", mode: "write", approval: "per-use", scopes: ["project"] },
    ],
    network: { allowed: false, destinations: [] },
    filesystem: { allowed: true, scopes: ["authorized-project-root"] },
    limits: { timeoutMs: 5000, maxOutputBytes: 262144 },
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grantId: "grant-1",
    approvalId: "approval-1",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    action: "files.metadata.read",
    mode: "read",
    approved: false,
    source: "composition",
    ownerKind: "device",
    ownerId: null,
    spaceId: "space-dev",
    projectId: "project-ordax",
    expiresAt: null,
    ...overrides,
  };
}

test("tool definition is typed, bounded and sandboxed", () => {
  const value = defineIntelligenceTool(tool());
  assert.equal(value.schema, INTELLIGENCE_TOOL_SCHEMA);
  assert.equal(value.sandbox, "wasi-component");
  assert.equal(value.network.allowed, false);
  assert.equal(Object.isFrozen(value), true);
});

test("content can never create tool authority", () => {
  for (const source of ["prompt", "model", "profile", "profile-pack", "memory", "project-content"]) {
    assert.throws(
      () => validateIntelligenceToolGrant(grant({ source })),
      /content cannot create tool authority/,
    );
  }
});

test("tool grants use the canonical device/account owner model", () => {
  const device = validateIntelligenceToolGrant(grant());
  assert.equal(device.ownerKind, "device");
  assert.equal(device.ownerId, null);
  assert.throws(
    () => validateIntelligenceToolGrant(grant({ ownerId: "invented-device-owner" })),
    /must not invent/,
  );
  assert.throws(
    () => validateIntelligenceToolGrant(grant({ ownerKind: "account", ownerId: null })),
    /owner id/,
  );
  const account = validateIntelligenceToolGrant(grant({
    ownerKind: "account",
    ownerId: "user-1",
  }));
  assert.equal(account.ownerId, "user-1");
});

test("write grant requires explicit approval", () => {
  assert.throws(
    () => validateIntelligenceToolGrant(grant({
      action: "files.text.write",
      mode: "write",
      approved: false,
    })),
    /explicit approval/,
  );
  assert.throws(
    () => validateIntelligenceToolGrant(grant({
      action: "files.text.write",
      mode: "write",
      approved: true,
    })),
    /resource reference/,
  );
  const approved = validateIntelligenceToolGrant(grant({
    action: "files.text.write",
    mode: "write",
    approved: true,
    resourceRef: "file-space:/Documentos/menu.md",
  }));
  assert.equal(approved.schema, INTELLIGENCE_TOOL_GRANT_SCHEMA);
});

test("generic shell and raw disk are forbidden even when requested by a tool", () => {
  for (const id of ["shell.generic", "host.raw-disk"]) {
    assert.throws(
      () => defineIntelligenceTool(tool({
        actions: [{ id, mode: "read", approval: "none", scopes: [] }],
      })),
      /forbidden/,
    );
  }
});

test("authorization binds exact tool, action and mode", () => {
  assert.equal(authorizeIntelligenceToolAction(tool(), grant()), true);
  assert.equal(authorizeIntelligenceToolAction(tool(), grant({ toolId: "other-tool" })), false);
  assert.equal(authorizeIntelligenceToolAction(tool(), grant({ toolArtifactSha256: "b".repeat(64) })), false);
  assert.equal(authorizeIntelligenceToolAction(tool(), grant({
    action: "files.text.write",
    mode: "read",
  })), false);
});
