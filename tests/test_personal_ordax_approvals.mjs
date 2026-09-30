import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  PERSONAL_ORDAX_STORE_SCHEMA,
  validatePersonalOrdaxStoreState,
} from "../system/contracts/personal-ordax-store.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

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

function identity(subjectId = "user-1") {
  return observablePort(IDENTITY_SESSION_SCHEMA, {
    state: "signed-in",
    subjectId,
    displayName: "User",
  });
}

function spaces(subjectId = "user-1", spaceId = "space-1") {
  return observablePort(SPACE_SELECTION_SCHEMA, {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace: {
      id: spaceId,
      name: "Pizzaria",
      kind: "professional",
      ownerId: subjectId,
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

function grant(overrides = {}) {
  return {
    grantId: "grant-1",
    workItemId: "personal-work-1",
    approvalId: "personal-approval-personal-work-1-1",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    action: "files.document.write",
    mode: "write",
    approved: true,
    source: "user-approval",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: null,
    resourceRef: "file-space:/Documentos/menu.md",
    expiresAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function actionGateway(grants = [grant()]) {
  const byGrant = new Map(grants.map((entry) => [entry.grantId, entry]));
  return createPersonalOrdaxActionGateway({
    toolResolver(id) {
      return id === "files-inspector" ? tool() : null;
    },
    grantResolver(id) {
      return byGrant.get(id) ?? null;
    },
    now: () => Date.parse("2026-09-30T21:30:00.000Z"),
  });
}

function store() {
  let value = null;
  return {
    schema: PERSONAL_ORDAX_STORE_SCHEMA,
    scope: "device",
    load() {
      return value;
    },
    save(owner, next) {
      value = next;
      return true;
    },
    read() {
      return value;
    },
  };
}

test("approval request is persisted atomically with waiting Work and Activity", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const persistence = store();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    store: persistence,
    now: () => tick++,
  });
  const work = runtime.create("Atualizar o documento.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Atualizar o documento aprovado pelo usuário.",
  });

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "waiting-approval");
  assert.equal(snapshot.workItems[0].pendingApprovalId, approval.id);
  assert.equal(snapshot.approvals.length, 1);
  assert.equal(snapshot.approvals[0].status, "pending");
  assert.equal(snapshot.approvals[0].resourceRef, "file-space:/Documentos/menu.md");
  assert.equal(snapshot.approvals[0].toolArtifactSha256, "a".repeat(64));
  assert.equal(snapshot.decisions.length, 0);
  assert.equal(snapshot.activities.at(-1).type, "approval-requested");
  assert.equal(snapshot.activities.at(-1).approvalId, approval.id);
  assert.equal(persistence.read().approvals[0].id, approval.id);
  runtime.dispose();
});

test("missing grant keeps approval pending and cannot execute", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: actionGateway(),
    now: () => tick++,
  });
  const work = runtime.create("Atualizar.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Precisa de grant.",
  });
  const decision = runtime.resolveApproval(work.id, approval.id);
  assert.equal(decision.decision, "approval-required");
  assert.equal(runtime.getSnapshot().workItems[0].state, "waiting-approval");
  assert.equal(runtime.getSnapshot().approvals[0].status, "pending");
  assert.equal(runtime.getSnapshot().decisions.length, 0);
  runtime.dispose();
});

test("exact existing grant resolves approval to queued work and durable allow decision", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: actionGateway(),
    now: () => tick++,
  });
  const work = runtime.create("Atualizar.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Escrever no documento do Space.",
  });
  const decision = runtime.resolveApproval(work.id, approval.id, { grantRef: "grant-1" });

  const snapshot = runtime.getSnapshot();
  assert.equal(decision.decision, "allow");
  assert.equal(snapshot.workItems[0].state, "queued");
  assert.equal(snapshot.workItems[0].pendingApprovalId, null);
  assert.equal(snapshot.approvals[0].status, "approved");
  assert.equal(snapshot.approvals[0].grantRef, "grant-1");
  assert.equal(snapshot.decisions[0].decision, "allow");
  assert.equal(snapshot.decisions[0].grantRef, "grant-1");
  assert.equal(snapshot.activities.at(-1).type, "approval-resolved");
  assert.equal(snapshot.activities.at(-1).approvalId, approval.id);
  const execution = runtime.prepareActionExecution(work.id, approval.id);
  assert.equal(execution.request.approvalId, approval.id);
  assert.equal(execution.request.resourceRef, "file-space:/Documentos/menu.md");
  assert.equal(execution.decision.grantRef, "grant-1");
  runtime.dispose();
});

test("wrong-owner grant resolves fail-closed to denied and paused work", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: actionGateway([grant({ ownerId: "user-2" })]),
    now: () => tick++,
  });
  const work = runtime.create("Atualizar.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Grant errado não pode atravessar owner.",
  });
  const decision = runtime.resolveApproval(work.id, approval.id, { grantRef: "grant-1" });

  const snapshot = runtime.getSnapshot();
  assert.equal(decision.decision, "deny");
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.approvals[0].status, "denied");
  assert.equal(snapshot.approvals[0].grantRef, null);
  assert.equal(snapshot.decisions[0].decision, "deny");
  runtime.dispose();
});

test("identity or Space change cancels pending approval before pausing work", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const session = identity();
  const selection = spaces();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: session,
    spaceSelectionPort: selection,
    now: () => tick++,
  });
  const work = runtime.create("Bound.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Pending.",
  });

  selection.setSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.workItems[0].pendingApprovalId, null);
  assert.equal(snapshot.approvals[0].status, "cancelled");
  assert.deepEqual(
    snapshot.activities.slice(-2).map((event) => event.type),
    ["approval-resolved", "paused"],
  );
  assert.equal(snapshot.activities.at(-2).approvalId, approval.id);

  session.setSnapshot({
    state: "signed-in",
    subjectId: "user-2",
    displayName: "Other",
  });
  assert.equal(runtime.getSnapshot().workItems.length, 0);
  runtime.dispose();
});

test("store rejects orphan approvals, missing audit Activity and forged terminal decisions", () => {
  let tick = Date.parse("2026-09-30T21:00:00.000Z");
  const persistence = store();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: actionGateway(),
    store: persistence,
    now: () => tick++,
  });
  const work = runtime.create("Atualizar.", { spaceId: "space-1" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/menu.md",
    reason: "Auditável.",
  });
  runtime.resolveApproval(work.id, approval.id, { grantRef: "grant-1" });
  const saved = persistence.read();

  assert.throws(() => validatePersonalOrdaxStoreState({
    ...saved,
    activities: saved.activities.filter((event) => event.type !== "approval-requested"),
  }), /approval requires exactly one approval-requested activity/);

  assert.throws(() => validatePersonalOrdaxStoreState({
    ...saved,
    decisions: saved.decisions.map((decision) => ({ ...decision, grantRef: "grant-forged" })),
  }), /matching allow decision/);

  assert.throws(() => validatePersonalOrdaxStoreState({
    ...saved,
    approvals: saved.approvals.map((entry) => ({ ...entry, workItemId: "missing-work" })),
  }), /cannot reference missing work/);
  runtime.dispose();
});
