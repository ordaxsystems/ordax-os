import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

function observable(schema, snapshot, methods = {}) {
  return {
    schema,
    getSnapshot: () => snapshot,
    subscribe() { return () => {}; },
    ...methods,
  };
}

function identity() {
  return observable(IDENTITY_SESSION_SCHEMA, {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "User A",
  });
}

function spaces() {
  return observable(SPACE_SELECTION_SCHEMA, {
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
  }, { select() {}, clear() {} });
}

function tool() {
  return {
    id: "ordax-native-file-space",
    version: "1.0.0",
    artifactSha256: "c".repeat(64),
    sandbox: "native-broker",
    actions: [{
      id: "files.directory.ensure",
      mode: "write",
      approval: "per-use",
      scopes: ["user-file-space"],
    }],
    network: { allowed: false, destinations: [] },
    filesystem: { allowed: true, scopes: ["user-file-space"] },
    limits: { timeoutMs: 5000, maxOutputBytes: 16384 },
  };
}

function grant(approvalId) {
  return {
    grantId: "grant-1",
    workItemId: "personal-work-1",
    approvalId,
    toolId: "ordax-native-file-space",
    toolArtifactSha256: "c".repeat(64),
    action: "files.directory.ensure",
    mode: "write",
    approved: true,
    source: "user-approval",
    ownerKind: "account",
    ownerId: "user-a",
    spaceId: "space-a",
    projectId: null,
    resourceRef: "file-space:/Documentos/Novo",
    expiresAt: "2026-10-01T00:00:00.000Z",
  };
}

function setup() {
  let now = Date.parse("2026-09-30T22:30:00.000Z");
  const grants = new Map();
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver: (id) => id === tool().id ? tool() : null,
    grantResolver: (id) => grants.get(id) ?? null,
    now: () => now,
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity(),
    spaceSelectionPort: spaces(),
    actionGatewayPort: gateway,
    now: () => now++,
  });
  const work = runtime.create("Garantir pasta do projeto", { spaceId: "space-a" });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.directory.ensure",
    toolId: "ordax-native-file-space",
    toolArtifactSha256: "c".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/Novo",
    reason: "Garantir a pasta explicitamente aprovada.",
  });
  grants.set("grant-1", grant(approval.id));
  const decision = runtime.resolveApproval(work.id, approval.id, { grantRef: "grant-1" });
  return {
    runtime,
    work,
    approval,
    decision,
    nextTime() {
      now += 1000;
      return new Date(now).toISOString();
    },
  };
}

function receipt(workId, approvalId, executedAt, overrides = {}) {
  return {
    workItemId: workId,
    approvalId,
    toolId: "ordax-native-file-space",
    toolArtifactSha256: "c".repeat(64),
    actionId: "files.directory.ensure",
    effect: "write",
    resourceRef: "file-space:/Documentos/Novo",
    grantRef: "grant-1",
    status: "succeeded",
    summary: "Diretório garantido no file-space.",
    artifactRefs: ["file-space:/Documentos/Novo"],
    executedAt,
    ...overrides,
  };
}

test("foreground action lifecycle atomically consumes approval after verified receipt", () => {
  const { runtime, work, approval, nextTime } = setup();
  const execution = runtime.startActionExecution(work.id, approval.id);
  let snapshot = runtime.getSnapshot();

  assert.equal(snapshot.workItems[0].state, "running");
  assert.equal(snapshot.approvals[0].status, "approved");
  assert.equal(snapshot.activities.at(-1).type, "action-started");
  assert.equal(execution.request.resourceRef, "file-space:/Documentos/Novo");

  const actionReceipt = receipt(work.id, approval.id, nextTime());
  runtime.finishActionExecution(work.id, approval.id, actionReceipt);
  snapshot = runtime.getSnapshot();

  assert.equal(snapshot.workItems[0].state, "queued");
  assert.equal(snapshot.approvals[0].status, "executed");
  assert.equal(snapshot.approvals[0].executedAt, actionReceipt.executedAt);
  assert.equal(snapshot.activities.at(-1).type, "action-finished");
  assert.equal(snapshot.activities.at(-1).approvalId, approval.id);
  assert.deepEqual(snapshot.activities.at(-1).artifactRefs, ["file-space:/Documentos/Novo"]);

  assert.throws(
    () => runtime.startActionExecution(work.id, approval.id),
    /unconsumed approved approval/,
  );
  runtime.dispose();
});

test("same bounded action type can be requested again through a new approval identity", () => {
  const { runtime, work, approval, nextTime } = setup();
  runtime.startActionExecution(work.id, approval.id);
  runtime.finishActionExecution(
    work.id,
    approval.id,
    receipt(work.id, approval.id, nextTime()),
  );

  const second = runtime.requestApproval(work.id, {
    actionId: "files.directory.ensure",
    toolId: "ordax-native-file-space",
    toolArtifactSha256: "c".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Documentos/Outro",
    reason: "Garantir outro diretório com uma nova aprovação.",
  });
  const snapshot = runtime.getSnapshot();

  assert.notEqual(second.id, approval.id);
  assert.equal(second.id, "personal-approval-personal-work-1-2");
  assert.equal(snapshot.approvals.length, 2);
  assert.equal(snapshot.approvals[0].status, "executed");
  assert.equal(snapshot.approvals[1].status, "pending");
  assert.equal(snapshot.workItems[0].pendingApprovalId, second.id);
  runtime.dispose();
});

test("receipt substitution cannot consume retained approval", () => {
  const { runtime, work, approval, nextTime } = setup();
  runtime.startActionExecution(work.id, approval.id);

  assert.throws(
    () => runtime.finishActionExecution(
      work.id,
      approval.id,
      receipt(work.id, approval.id, nextTime(), {
        resourceRef: "file-space:/Documentos/Outro",
      }),
    ),
    /does not match retained authority/,
  );
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "running");
  assert.equal(snapshot.approvals[0].status, "approved");
  runtime.dispose();
});

test("failed receipt cannot consume an approval", () => {
  const { runtime, work, approval, nextTime } = setup();
  runtime.startActionExecution(work.id, approval.id);
  assert.throws(
    () => runtime.finishActionExecution(
      work.id,
      approval.id,
      receipt(work.id, approval.id, nextTime(), { status: "failed" }),
    ),
    /succeeded Action Receipt/,
  );
  assert.equal(runtime.getSnapshot().approvals[0].status, "approved");
  runtime.dispose();
});

test("failed foreground action pauses without consuming approval so idempotent retry stays explicit", () => {
  const { runtime, work, approval } = setup();
  runtime.startActionExecution(work.id, approval.id);
  runtime.failActionExecution(work.id, approval.id);

  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.approvals[0].status, "approved");
  assert.equal(snapshot.approvals[0].executedAt, null);
  assert.equal(snapshot.activities.at(-1).type, "action-finished");

  runtime.resume(work.id);
  const execution = runtime.startActionExecution(work.id, approval.id);
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "running");
  assert.equal(execution.request.approvalId, approval.id);
  runtime.dispose();
});
