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
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
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

  assert.equal(runtime.approvalConsent.canApprove(work.id, approval.id), true);
  const decision = runtime.approvalConsent.approve(work.id, approval.id);
  assert.equal(decision.decision, "allow");
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), true);

  const receipt = await runtime.executeApprovedAction(work.id, approval.id);
  const snapshot = runtime.getSnapshot();

  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.toolArtifactSha256, actions.tool.artifactSha256);
  assert.deepEqual(files.calls, [{ path: "/Documentos", name: "Novo" }]);
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
