import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  NATIVE_FILE_ACTION_TOOL_ID,
  NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  createNativePersonalOrdaxFileActions,
} from "../system/adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";
import { projectPersonalWorkCanvas } from "../system/services/intelligence/work-canvas.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function identitySession() {
  const snapshot = {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "User A",
  };
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe() { return () => {}; },
  };
}

function fileSpace() {
  const entries = [];
  const calls = [];
  return {
    calls,
    port: {
      schema: FILE_SPACE_SCHEMA,
      async list(path = "/") {
        return { path, entries: [...entries] };
      },
      async createDirectory(path, name) {
        calls.push({ path, name });
        entries.push({ name, kind: "directory", size: 0, modifiedAt: 1 });
        return { path, entries: [...entries] };
      },
      async readTextFile() { throw new Error("unused"); },
      async renameEntry() { throw new Error("unused"); },
      async copyFile() { throw new Error("unused"); },
      async moveEntry() { throw new Error("unused"); },
      async trashEntry() { throw new Error("unused"); },
      async listTrash() { throw new Error("unused"); },
      async restoreTrashEntry() { throw new Error("unused"); },
      async exportFile() { throw new Error("unused"); },
      async importFile() { throw new Error("unused"); },
    },
  };
}

test("explicit approval executes the verified Native file action and consumes authority", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const actionCatalog = createPersonalActionCatalog({
    registrations: actions.actionRegistrations,
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });

  const work = runtime.create("Garantir pasta aprovada");
  assert.deepEqual(
    runtime.listAvailableActions().map((entry) => entry.id),
    ["native-file.ensure-directory"],
  );
  const approval = runtime.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Novo" },
  );

  assert.equal(runtime.approvalConsent.canApprove(work.id, approval.id), true);
  const decision = runtime.approvalConsent.approve(work.id, approval.id);
  assert.equal(decision.decision, "allow");
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), true);
  await assert.rejects(
    () => runtime.run(work.id),
    /approved action that must execute or be cancelled first/,
  );

  const receipt = await runtime.executeApprovedAction(work.id, approval.id);
  const snapshot = runtime.getSnapshot();

  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.toolArtifactSha256, actions.tool.artifactSha256);
  assert.deepEqual(files.calls, [{ path: "/Documentos", name: "Novo" }]);
  const verified = projectPersonalWorkCanvas(snapshot, {
    ownerKind: "account", ownerId: "user-a",
    spaceId: null, projectId: null, workItemId: work.id,
  });
  assert.equal(verified.state, "working");
  assert.deepEqual(verified.actionEvidence.map(entry => entry.status), ["succeeded"]);
  assert.equal(verified.actionEvidence[0].actionId, "native-file.ensure-directory");
  assert.equal(verified.actionEvidence[0].sourceSchema, "ordax.personal-action-attempt/1");
  assert.equal(verified.actionEvidence[0].finishedAt !== null, true);
  assert.equal(verified.pendingApproval, null);
  assert.deepEqual(verified.blocks, []);
  assert.equal("resourceRef" in verified.actionEvidence[0], false);
  assert.equal("grantRef" in verified.actionEvidence[0], false);
  assert.equal("artifactRefs" in verified.actionEvidence[0], false);
  assert.equal(snapshot.workItems[0].state, "queued");
  assert.equal(snapshot.approvals[0].status, "executed");
  assert.ok(snapshot.approvals[0].executedAt);
  assert.equal(snapshot.activities.at(-1).type, "action-finished");
  assert.deepEqual(snapshot.activities.at(-1).artifactRefs, ["file-space:/Documentos/Novo"]);
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), false);

  await assert.rejects(
    () => runtime.executeApprovedAction(work.id, approval.id),
    /unconsumed approved approval/,
  );

  runtime.dispose();
});

test("Native restore turns a persisted started attempt into uncertain without retrying the side effect", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const actionCatalog = createPersonalActionCatalog({
    registrations: actions.actionRegistrations,
  });
  const storage = memoryStorage();
  const windowRef = { localStorage: storage };

  const first = createNativePersonalOrdaxComposition({
    windowRef,
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });
  const work = first.create("Garantir pasta com crash simulado");
  const approval = first.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Crash" },
  );
  first.approvalConsent.approve(work.id, approval.id);
  first.startActionExecution(work.id, approval.id);
  let snapshot = first.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "running");
  assert.equal(snapshot.attempts[0].status, "started");
  assert.deepEqual(files.calls, []);
  first.dispose();

  const restored = createNativePersonalOrdaxComposition({
    windowRef,
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });
  snapshot = restored.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(snapshot.attempts[0].status, "uncertain");
  assert.match(snapshot.attempts[0].summary, /uncertain/i);
  assert.deepEqual(files.calls, []);
  assert.equal(restored.canExecuteApprovedAction(work.id, approval.id), false);

  const replacement = restored.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Crash" },
  );
  assert.notEqual(replacement.id, approval.id);
  assert.equal(restored.getSnapshot().approvals.at(-1).status, "pending");
  restored.dispose();
});

test("Native restore revokes persisted approvals whose session grant no longer exists", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const actionCatalog = createPersonalActionCatalog({
    registrations: actions.actionRegistrations,
  });
  const storage = memoryStorage();
  const windowRef = { localStorage: storage };

  const first = createNativePersonalOrdaxComposition({
    windowRef,
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });
  const work = first.create("Garantir pasta depois de reiniciar");
  const approval = first.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Novo" },
  );
  first.approvalConsent.approve(work.id, approval.id);
  assert.equal(first.getSnapshot().approvals[0].status, "approved");
  first.dispose();

  const restored = createNativePersonalOrdaxComposition({
    windowRef,
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });
  let snapshot = restored.getSnapshot();
  assert.equal(snapshot.workItems[0].state, "queued");
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(restored.canExecuteApprovedAction(work.id, approval.id), false);

  const replacement = restored.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Outro" },
  );
  snapshot = restored.getSnapshot();
  assert.notEqual(replacement.id, approval.id);
  assert.equal(snapshot.approvals.at(-1).status, "pending");

  restored.dispose();
});

test("adapter-entered failure revokes authority and retains an uncertain attempt", async () => {
  const files = fileSpace();
  const failingPort = {
    ...files.port,
    async createDirectory(path, name) {
      files.calls.push({ path, name });
      throw new Error("simulated adapter failure after entry");
    },
  };
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: failingPort,
    artifactIdentity: async () => "c".repeat(64),
  });
  const actionCatalog = createPersonalActionCatalog({
    registrations: actions.actionRegistrations,
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
  });
  const work = runtime.create("Garantir pasta com falha incerta");
  const approval = runtime.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Incerto" },
  );
  runtime.approvalConsent.approve(work.id, approval.id);

  await assert.rejects(
    () => runtime.executeApprovedAction(work.id, approval.id),
    /uncertain after entering the typed adapter/,
  );
  const snapshot = runtime.getSnapshot();
  assert.deepEqual(files.calls, [{ path: "/Documentos", name: "Incerto" }]);
  assert.equal(snapshot.workItems[0].state, "paused");
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(snapshot.attempts[0].status, "uncertain");
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), false);
  const uncertainCanvas = projectPersonalWorkCanvas(snapshot, {
    ownerKind: "account", ownerId: "user-a",
    spaceId: null, projectId: null, workItemId: work.id,
  });
  assert.equal(uncertainCanvas.state, "requires-action");
  assert.deepEqual(uncertainCanvas.actionEvidence.map(entry => entry.status), ["uncertain"]);
  assert.equal(uncertainCanvas.actionEvidence[0].sourceSchema, "ordax.personal-action-attempt/1");
  assert.equal(uncertainCanvas.resultId, null);
  assert.deepEqual(uncertainCanvas.blocks, []);

  runtime.dispose();
});

test("missing or substituted adapter cannot execute an approved action", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver() {
      return null;
    },
  });
  const work = runtime.create("Garantir pasta aprovada");
  const approval = runtime.requestApproval(work.id, {
    actionId: NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
    toolId: NATIVE_FILE_ACTION_TOOL_ID,
    toolArtifactSha256: actions.tool.artifactSha256,
    effect: "write",
    resourceRef: "file-space:/Documentos/Novo",
    reason: "Garantir a pasta solicitada pelo usuário.",
  });
  runtime.approvalConsent.approve(work.id, approval.id);

  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), false);
  await assert.rejects(
    () => runtime.executeApprovedAction(work.id, approval.id),
    /compatible typed Action Adapter/,
  );
  assert.deepEqual(files.calls, []);
  assert.equal(runtime.getSnapshot().workItems[0].state, "paused");
  assert.equal(runtime.getSnapshot().approvals[0].status, "approved");

  runtime.dispose();
});


test("cancelling Work revokes the approved grant before retaining cancellation", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const authority = createIntelligenceToolGrantAuthority({
    createGrantId: () => "grant-cancel-1",
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    grantAuthority: authority,
  });
  const work = runtime.create("Garantir pasta aprovada");
  const approval = runtime.requestApproval(work.id, {
    actionId: NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
    toolId: NATIVE_FILE_ACTION_TOOL_ID,
    toolArtifactSha256: actions.tool.artifactSha256,
    effect: "write",
    resourceRef: "file-space:/Documentos/Novo",
    reason: "Garantir a pasta solicitada pelo usuário.",
  });
  const decision = runtime.approvalConsent.approve(work.id, approval.id);
  assert.ok(authority.registry.resolve(decision.grantRef));

  runtime.cancel(work.id);
  const snapshot = runtime.getSnapshot();
  assert.equal(authority.registry.resolve(decision.grantRef), null);
  assert.equal(snapshot.workItems[0].state, "cancelled");
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(snapshot.approvals[0].grantRef, decision.grantRef);
  assert.deepEqual(files.calls, []);

  runtime.dispose();
  authority.dispose();
});
