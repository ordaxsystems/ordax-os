import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { createNativePersonalOrdaxFileActions } from "../system/adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function identitySession() {
  const snapshot = { state: "signed-in", subjectId: "user-a", displayName: "User A" };
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
      async list(path = "/") { return { path, entries: [...entries] }; },
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

test("expired live grant is revoked before foreground execution can enter the adapter", async () => {
  let now = Date.parse("2026-09-30T23:00:00.000Z");
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "c".repeat(64),
  });
  const authority = createIntelligenceToolGrantAuthority({
    now: () => now,
    createGrantId: () => "grant-expiry-1",
  });
  const actionCatalog = createPersonalActionCatalog({ registrations: actions.actionRegistrations });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: null,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog,
    grantAuthority: authority,
  });

  const work = runtime.create("Garantir pasta antes do grant expirar");
  const approval = runtime.requestAvailableAction(
    work.id,
    "native-file.ensure-directory",
    { resourceValue: "/Documentos/Novo" },
  );
  const decision = runtime.approvalConsent.approve(work.id, approval.id);

  assert.ok(authority.registry.resolve(decision.grantRef));
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), true);

  now += (2 * 60 * 1000) + 1;

  assert.equal(runtime.reconcileApprovedAuthority(), true);
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(authority.registry.resolve(decision.grantRef), null);
  assert.equal(runtime.canExecuteApprovedAction(work.id, approval.id), false);
  await assert.rejects(
    () => runtime.executeApprovedAction(work.id, approval.id),
    /unconsumed approved approval/,
  );
  assert.deepEqual(files.calls, []);

  assert.equal(runtime.reconcileApprovedAuthority(), false);
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.deepEqual(files.calls, []);

  runtime.dispose();
  authority.dispose();
});
