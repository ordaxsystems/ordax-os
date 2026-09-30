import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA,
  INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA,
} from "../system/contracts/intelligence-tool-grant-authority.mjs";
import {
  ACTION_EXECUTOR_SCHEMA,
  assertActionExecutor,
  validateAuthorizedActionExecution,
} from "../system/contracts/action-executor.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";

const NOW = Date.parse("2026-09-30T21:30:00.000Z");

function issue(overrides = {}) {
  return {
    workItemId: "personal-work-1",
    approvalId: "personal-approval-personal-work-1-1",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    action: "files.document.write",
    mode: "write",
    approvedBy: "user",
    ownerKind: "account",
    ownerId: "user-a",
    spaceId: "space-a",
    projectId: "project-a",
    resourceRef: "file-space:/Documentos/menu.md",
    requestedAt: "2026-09-30T21:30:00.000Z",
    expiresAt: "2026-09-30T21:34:00.000Z",
    ...overrides,
  };
}

test("canonical grant authority separates read-only registry from trusted issuer", () => {
  const authority = createIntelligenceToolGrantAuthority({
    now: () => NOW,
    createGrantId: () => "grant-user-a-1",
  });
  assert.equal(authority.registry.schema, INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA);
  assert.equal(authority.issuer.schema, INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA);
  assert.equal(typeof authority.registry.issue, "undefined");

  assert.throws(
    () => authority.issuer.issue(issue({ resourceRef: null })),
    /resource reference/,
  );

  const grant = authority.issuer.issue(issue());
  assert.equal(grant.grantId, "grant-user-a-1");
  assert.equal(grant.source, "user-approval");
  assert.equal(grant.approvalId, "personal-approval-personal-work-1-1");
  assert.equal(grant.ownerId, "user-a");
  assert.equal(grant.resourceRef, "file-space:/Documentos/menu.md");
  assert.equal(grant.toolArtifactSha256, "a".repeat(64));
  assert.equal(authority.registry.resolve(grant.grantId), grant);
  authority.dispose();
});

test("grant issuance is bounded, user-approved and exact-context", () => {
  const authority = createIntelligenceToolGrantAuthority({
    now: () => NOW,
    createGrantId: () => "grant-user-a-1",
  });

  assert.throws(
    () => authority.issuer.issue(issue({ approvedBy: "model" })),
    /explicit user approval/,
  );
  assert.throws(
    () => authority.issuer.issue(issue({
      ownerKind: "device",
      ownerId: "user-a",
    })),
    /must not invent an account owner id/,
  );
  assert.throws(
    () => authority.issuer.issue(issue({
      expiresAt: "2026-09-30T21:40:00.000Z",
    })),
    /bounded TTL/,
  );

  const grant = authority.issuer.issue(issue());
  assert.throws(
    () => authority.issuer.issue(issue()),
    /already issued a grant/,
  );
  assert.equal(authority.issuer.revoke(grant.grantId), true);
  assert.equal(authority.registry.resolve(grant.grantId), null);
  assert.throws(
    () => authority.issuer.issue(issue()),
    /already issued a grant/,
  );
  authority.dispose();
});

test("expired grants disappear from the registry and disposed authority fails closed", () => {
  let now = NOW;
  const authority = createIntelligenceToolGrantAuthority({
    now: () => now,
    createGrantId: () => "grant-user-a-1",
  });
  const grant = authority.issuer.issue(issue());
  now = Date.parse("2026-09-30T21:34:00.000Z");
  assert.equal(authority.registry.resolve(grant.grantId), null);

  authority.dispose();
  assert.throws(() => authority.registry.resolve(grant.grantId), /disposed/);
  assert.throws(() => authority.issuer.issue(issue()), /disposed/);
});

test("typed Action Executor boundary rejects non-allow and mismatched decisions", () => {
  const request = {
    workItemId: "personal-work-1",
    approvalId: "personal-approval-personal-work-1-1",
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    ownerKind: "account",
    ownerId: "user-a",
    spaceId: "space-a",
    projectId: "project-a",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Salvar alteracao aprovada.",
    requestedAt: "2026-09-30T21:30:00.000Z",
  };
  const decision = {
    workItemId: "personal-work-1",
    actionId: "files.document.write",
    effect: "write",
    decision: "allow",
    authoritySource: "intelligence-tool-grant",
    grantRef: "grant-user-a-1",
    reason: "Exact scoped grant.",
    decidedAt: "2026-09-30T21:30:01.000Z",
  };

  const execution = validateAuthorizedActionExecution({ request, decision });
  assert.equal(execution.request.ownerId, "user-a");
  assert.equal(execution.decision.grantRef, "grant-user-a-1");

  assert.throws(
    () => validateAuthorizedActionExecution({
      request,
      decision: { ...decision, decision: "deny", grantRef: null },
    }),
    /requires an allow decision/,
  );
  assert.throws(
    () => validateAuthorizedActionExecution({
      request,
      decision: { ...decision, actionId: "files.other.write" },
    }),
    /does not match/,
  );

  const executor = {
    schema: ACTION_EXECUTOR_SCHEMA,
    async execute() {},
  };
  assert.equal(assertActionExecutor(executor), executor);
});
