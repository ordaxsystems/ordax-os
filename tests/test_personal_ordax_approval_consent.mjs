import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA } from "../system/contracts/intelligence-tool-grant-authority.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import { createPersonalApprovalConsent } from "../system/services/personal-ordax/approval-consent.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

const NOW = Date.parse("2026-09-30T22:00:00.000Z");

function observablePort(schema, initial, methods = {}) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    ...methods,
  };
}

function identity() {
  return observablePort(IDENTITY_SESSION_SCHEMA, {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "User A",
  });
}

function spaces() {
  return observablePort(SPACE_SELECTION_SCHEMA, {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-a",
    selectedSpace: {
      id: "space-a",
      name: "Pizzaria",
      kind: "professional",
      ownerId: "user-a",
      profilePack: "pizzaria-br",
      state: "active",
    },
  }, {
    select() {},
    clear() {},
  });
}

function tool() {
  return {
    id: "files-inspector",
    version: "1.0.0",
    artifactSha256: "a".repeat(64),
    sandbox: "wasi-component",
    actions: [{
      id: "files.document.write",
      mode: "write",
      approval: "per-use",
      scopes: ["space"],
    }],
    network: { allowed: false, destinations: [] },
    filesystem: { allowed: true, scopes: ["/Documentos"] },
    limits: { timeoutMs: 1000, maxOutputBytes: 4096 },
  };
}

function setup({ selection = spaces(), issuerTransform = null } = {}) {
  let grantOrdinal = 0;
  const authority = createIntelligenceToolGrantAuthority({
    now: () => NOW,
    createGrantId() {
      grantOrdinal += 1;
      return `grant-consent-${grantOrdinal}`;
    },
  });
  const issuer = issuerTransform?.(authority.issuer) ?? authority.issuer;
  const toolResolver = (id) => id === "files-inspector" ? tool() : null;
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver,
    grantResolver(id) {
      return authority.registry.resolve(id);
    },
    now: () => NOW,
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: selection,
    actionGatewayPort: gateway,
    now: () => NOW,
  });
  const consent = createPersonalApprovalConsent({
    runtime,
    grantIssuer: issuer,
    toolResolver,
    now: () => NOW,
  });
  return { authority, runtime, consent, selection };
}

function pending(runtime, effect = "write") {
  const work = runtime.create("Atualizar documento", { spaceId: "space-a" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect,
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Salvar a alteracao solicitada pelo usuario.",
  });
  return { work, approval };
}

test("explicit human approval issues one exact short-lived grant and resolves Work", () => {
  const { authority, runtime, consent } = setup();
  const { work, approval } = pending(runtime);

  assert.equal(consent.canApprove(work.id, approval.id), true);
  const decision = consent.approve(work.id, approval.id);
  const snapshot = runtime.getSnapshot();

  assert.equal(decision.decision, "allow");
  assert.equal(decision.authoritySource, "intelligence-tool-grant");
  assert.ok(decision.grantRef);
  assert.equal(snapshot.workItems[0].state, "queued");
  assert.equal(snapshot.approvals[0].status, "approved");
  assert.equal(snapshot.approvals[0].grantRef, decision.grantRef);

  const grant = authority.registry.resolve(decision.grantRef);
  assert.equal(grant.ownerId, "user-a");
  assert.equal(grant.spaceId, "space-a");
  assert.equal(grant.projectId, null);
  assert.equal(grant.approvalId, approval.id);
  assert.equal(grant.resourceRef, "file-space:/Documentos/menu.md");
  assert.equal(grant.toolId, "files-inspector");
  assert.equal(grant.toolArtifactSha256, "a".repeat(64));
  assert.equal(grant.action, "files.document.write");
  assert.equal(grant.mode, "write");
  assert.equal(Date.parse(grant.expiresAt) - NOW, 2 * 60 * 1000);

  runtime.dispose();
  authority.dispose();
});

test("explicit human denial is audited without issuing authority", () => {
  let issueCalls = 0;
  const { authority, runtime, consent } = setup({
    issuerTransform(base) {
      return Object.freeze({
        schema: INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA,
        issue(value) {
          issueCalls += 1;
          return base.issue(value);
        },
        revoke: base.revoke,
      });
    },
  });
  const { work, approval } = pending(runtime);

  const decision = consent.deny(work.id, approval.id);
  const snapshot = runtime.getSnapshot();

  assert.equal(issueCalls, 0);
  assert.equal(decision.decision, "deny");
  assert.equal(decision.authoritySource, "user-grant");
  assert.equal(decision.grantRef, null);
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.approvals[0].status, "denied");
  assert.equal(snapshot.decisions[0].decision, "deny");
  assert.equal(snapshot.activities.at(-1).type, "approval-resolved");

  runtime.dispose();
  authority.dispose();
});

test("consent preflight hides Approve when the typed tool action is unavailable", () => {
  const authority = createIntelligenceToolGrantAuthority({
    now: () => NOW,
    createGrantId: () => "grant-unavailable-1",
  });
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver: () => null,
    grantResolver: (id) => authority.registry.resolve(id),
    now: () => NOW,
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: gateway,
    now: () => NOW,
  });
  const consent = createPersonalApprovalConsent({
    runtime,
    grantIssuer: authority.issuer,
    toolResolver: () => null,
    now: () => NOW,
  });
  const { work, approval } = pending(runtime);

  assert.equal(consent.canApprove(work.id, approval.id), false);
  assert.throws(
    () => consent.approve(work.id, approval.id),
    /unavailable or incompatible/,
  );
  assert.equal(runtime.getSnapshot().approvals[0].status, "pending");

  runtime.dispose();
  authority.dispose();
});

test("consent refuses approval after the resolved tool artifact changes", () => {
  const { authority, runtime } = setup();
  const { work, approval } = pending(runtime);
  const consent = createPersonalApprovalConsent({
    runtime,
    grantIssuer: authority.issuer,
    toolResolver(id) {
      if (id !== "files-inspector") return null;
      return tool({ artifactSha256: "b".repeat(64) });
    },
    now: () => NOW,
  });

  assert.equal(consent.canApprove(work.id, approval.id), false);
  assert.throws(
    () => consent.approve(work.id, approval.id),
    /unavailable or incompatible/,
  );
  assert.equal(runtime.getSnapshot().approvals[0].status, "pending");

  runtime.dispose();
  authority.dispose();
});

test("tool-grant consent refuses egress/device authority and leaves approval pending", () => {
  const { authority, runtime, consent } = setup();
  const { work, approval } = pending(runtime, "external-egress");

  assert.throws(
    () => consent.approve(work.id, approval.id),
    /dedicated authority/,
  );
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "waiting-approval");
  assert.equal(snapshot.approvals[0].status, "pending");

  runtime.dispose();
  authority.dispose();
});

test("grant is revoked if context changes before approval resolution commits", () => {
  const selection = spaces();
  let issuedGrantId = null;
  const { authority, runtime, consent } = setup({
    selection,
    issuerTransform(base) {
      return Object.freeze({
        schema: INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA,
        issue(value) {
          const grant = base.issue(value);
          issuedGrantId = grant.grantId;
          selection.setSnapshot({
            schema: SPACE_SELECTION_SCHEMA,
            state: "unselected",
            subjectId: "user-a",
            selectedSpace: null,
          });
          return grant;
        },
        revoke: base.revoke,
      });
    },
  });
  const { work, approval } = pending(runtime);

  assert.throws(
    () => consent.approve(work.id, approval.id),
    /not pending/,
  );
  assert.ok(issuedGrantId);
  assert.equal(authority.registry.resolve(issuedGrantId), null);
  assert.equal(runtime.getSnapshot().workItems[0].state, "paused");
  assert.equal(runtime.getSnapshot().approvals[0].status, "cancelled");

  runtime.dispose();
  authority.dispose();
});
