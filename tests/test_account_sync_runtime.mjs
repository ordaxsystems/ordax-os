import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { SYNC_CHECKPOINT_STORE_SCHEMA } from "../system/contracts/sync-checkpoint-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { WORKSPACE_STORE_SCHEMA, createDefaultWorkspaceRecord, validateWorkspaceRecord } from "../system/contracts/workspace-store.mjs";
import { createPreferenceSnapshot, setPreferenceValue } from "../system/services/preferences/catalog.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { createNativeWorkspaceStore } from "../system/adapters/native/workspace.mjs";
import { createAccountSyncRuntime } from "../system/services/sync/account-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";

function signedInIdentity() {
  const snapshot = Object.freeze({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "Pessoa",
  });
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      return () => {};
    },
  };
}

function preferencesRuntime() {
  let snapshot = createPreferenceSnapshot();
  const listeners = new Set();
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    set(id, value) {
      const next = setPreferenceValue(snapshot, id, value);
      if (next === snapshot) return snapshot;
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

function workspaceStore() {
  let snapshot = createDefaultWorkspaceRecord();
  return {
    schema: WORKSPACE_STORE_SCHEMA,
    load: () => snapshot,
    save(next) {
      snapshot = validateWorkspaceRecord(next);
      return true;
    },
  };
}

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function checkpointStore(initial = null) {
  let value = initial;
  return {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: "device",
    load() {
      return value;
    },
    save(next) {
      value = next;
      return true;
    },
    peek() {
      return value;
    },
  };
}

test("account sync applies remote appearance, portable preferences and workspace without echo", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const applied = [];

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return {
        cursor: 11,
        objects: [
        {
          objectId: "appearance/theme",
          dataClass: "appearance",
          objectSchemaVersion: 1,
          resolverVersion: 1,
          serverRevision: 3,
          tombstone: false,
          payload: { theme: "dark" },
        },
        {
          objectId: "preferences/surface",
          dataClass: "preferences",
          objectSchemaVersion: 1,
          resolverVersion: 1,
          serverRevision: 5,
          tombstone: false,
          payload: {
            "accessibility.contrast": "high",
            "accessibility.motion": "reduced",
            "accessibility.text-scale": "large",
          },
        },
        {
          objectId: "workspace/portable",
          dataClass: "workspace-metadata",
          objectSchemaVersion: 1,
          resolverVersion: 1,
          serverRevision: 7,
          tombstone: false,
          payload: {
            activeAreaId: "area-2",
            areas: [
              { id: "area-1", ordinal: 1, appIds: ["files"] },
              { id: "area-2", ordinal: 2, appIds: ["settings"] },
            ],
          },
        },
      ],
      };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      applied.push(value);
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account"),
  });

  await sync.refresh();

  assert.equal(preferences.getSnapshot()["appearance.theme"], "dark");
  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "high");
  assert.equal(preferences.getSnapshot()["accessibility.motion"], "reduced");
  assert.equal(preferences.getSnapshot()["accessibility.text-scale"], "large");
  assert.equal(bridge.source.getSnapshot().activeAreaId, "area-2");
  assert.deepEqual(bridge.source.getSnapshot().areas[1].appIds, ["settings"]);
  assert.equal(preferenceSync.pendingMutations().length, 0);
  assert.equal(applied.length, 0, "remote state must not echo back as a new local mutation");
  assert.deepEqual(sync.getSnapshot().trackedDataClasses, [
    "appearance",
    "preferences",
    "workspace-metadata",
  ]);
  assert.equal(sync.getSnapshot().accountContinuity, "active");

  preferences.set("accessibility.contrast", "standard");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(applied.some((item) => item.objectId === "preferences/surface"), true);

  sync.destroy();
  preferenceSync.destroy();
});


test("local portable preference changes made before first reconciliation win over stale remote state", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-offline"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const applied = [];

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return {
        cursor: 20,
        objects: [
        {
          objectId: "preferences/surface",
          dataClass: "preferences",
          objectSchemaVersion: 1,
          resolverVersion: 1,
          serverRevision: 9,
          tombstone: false,
          payload: {
            "accessibility.contrast": "standard",
            "accessibility.motion": "standard",
            "accessibility.text-scale": "standard",
          },
        },
      ],
      };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      applied.push(value);
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-offline"),
  });

  preferences.set("accessibility.contrast", "high");
  assert.equal(sync.getSnapshot().pendingMutationCount > 0, true);

  await sync.refresh();

  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "high");
  const portable = applied.find((item) => item.objectId === "preferences/surface");
  assert.ok(portable, "local dirty preferences must be uploaded after reconciliation");
  assert.equal(portable.baseServerRevision, 9);
  assert.equal(portable.payload["accessibility.contrast"], "high");

  sync.destroy();
  preferenceSync.destroy();
});


test("persisted checkpoint resumes with incremental changes instead of another full snapshot", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-incremental"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const checkpoints = checkpointStore({
    subjectId: "user-1",
    cursor: 40,
    revisions: {
      "appearance/theme": 3,
      "preferences/surface": 5,
      "workspace/portable": 7,
    },
  });
  let snapshotCalls = 0;
  let pullCalls = 0;

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      snapshotCalls += 1;
      throw new Error("full snapshot must not run with a valid checkpoint");
    },
    async pullChanges({ afterCursor }) {
      pullCalls += 1;
      assert.equal(afterCursor, 40);
      return {
        afterCursor: 40,
        nextCursor: 41,
        changes: [
          {
            cursor: 41,
            objectId: "preferences/surface",
            dataClass: "preferences",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 6,
            tombstone: false,
            payload: {
              "accessibility.contrast": "high",
              "accessibility.motion": "standard",
              "accessibility.text-scale": "standard",
            },
          },
        ],
      };
    },
    async applyMutation(value) {
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
        changeCursor: 42,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpoints,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-incremental"),
  });

  await sync.refresh();

  assert.equal(snapshotCalls, 0);
  assert.equal(pullCalls, 1);
  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "high");
  assert.equal(checkpoints.peek().cursor, 41);
  assert.equal(checkpoints.peek().revisions["preferences/surface"], 6);

  sync.destroy();
  preferenceSync.destroy();
});


test("missing durable checkpoint store degrades to safe session checkpoint", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-session-fallback"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  let snapshotCalls = 0;

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      snapshotCalls += 1;
      return { cursor: 0, objects: [] };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
        changeCursor: 1,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-session-fallback"),
  });

  await sync.refresh();
  assert.equal(snapshotCalls, 1);
  assert.equal(sync.getSnapshot().accountContinuity, "active");

  sync.destroy();
  preferenceSync.destroy();
});


test("portable preference conflict rebases once and treats idempotent acceptance as confirmed", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-conflict"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const preferenceCalls = [];

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return {
        cursor: 50,
        objects: [
          {
            objectId: "appearance/theme",
            dataClass: "appearance",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 2,
            tombstone: false,
            payload: { theme: "light" },
          },
          {
            objectId: "preferences/surface",
            dataClass: "preferences",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 5,
            tombstone: false,
            payload: {
              "accessibility.contrast": "standard",
              "accessibility.motion": "standard",
              "accessibility.text-scale": "standard",
            },
          },
          {
            objectId: "workspace/portable",
            dataClass: "workspace-metadata",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 3,
            tombstone: false,
            payload: {
              activeAreaId: "area-1",
              areas: [{ id: "area-1", ordinal: 1, appIds: [] }],
            },
          },
        ],
      };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      if (value.objectId !== "preferences/surface") {
        return {
          $schema: "prototype-ordax.sync-ack/1",
          objectId: value.objectId,
          dataClass: value.dataClass,
          serverRevision: value.baseServerRevision + 1,
          tombstone: false,
          applied: true,
          conflict: false,
          changeCursor: 51,
        };
      }
      preferenceCalls.push(value);
      if (preferenceCalls.length === 1) {
        return {
          $schema: "prototype-ordax.sync-ack/1",
          objectId: value.objectId,
          dataClass: value.dataClass,
          serverRevision: 6,
          tombstone: false,
          applied: false,
          conflict: true,
          changeCursor: null,
        };
      }
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: 7,
        tombstone: false,
        applied: false,
        conflict: false,
        changeCursor: 52,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-conflict"),
  });

  await sync.refresh();
  preferences.set("accessibility.contrast", "high");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(preferenceCalls.length, 2);
  assert.equal(preferenceCalls[0].baseServerRevision, 5);
  assert.equal(preferenceCalls[1].baseServerRevision, 6);
  assert.equal(preferenceCalls[1].payload["accessibility.contrast"], "high");
  assert.notEqual(preferenceCalls[1].idempotencyKey, preferenceCalls[0].idempotencyKey);
  assert.equal(sync.getSnapshot().pendingMutationCount, 0);

  sync.destroy();
  preferenceSync.destroy();
});

test("repeated portable preference conflicts are bounded and leave rebased intent pending", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-bounded"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const preferenceCalls = [];

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return {
        cursor: 60,
        objects: [
          {
            objectId: "appearance/theme",
            dataClass: "appearance",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 1,
            tombstone: false,
            payload: { theme: "light" },
          },
          {
            objectId: "preferences/surface",
            dataClass: "preferences",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 8,
            tombstone: false,
            payload: {
              "accessibility.contrast": "standard",
              "accessibility.motion": "standard",
              "accessibility.text-scale": "standard",
            },
          },
          {
            objectId: "workspace/portable",
            dataClass: "workspace-metadata",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 1,
            tombstone: false,
            payload: {
              activeAreaId: "area-1",
              areas: [{ id: "area-1", ordinal: 1, appIds: [] }],
            },
          },
        ],
      };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      if (value.objectId !== "preferences/surface") {
        return {
          $schema: "prototype-ordax.sync-ack/1",
          objectId: value.objectId,
          dataClass: value.dataClass,
          serverRevision: value.baseServerRevision + 1,
          tombstone: false,
          applied: true,
          conflict: false,
          changeCursor: 61,
        };
      }
      preferenceCalls.push(value);
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: false,
        conflict: true,
        changeCursor: null,
      };
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-bounded"),
  });

  await sync.refresh();
  preferences.set("accessibility.contrast", "high");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(preferenceCalls.length, 2, "one original attempt plus one bounded rebase retry");
  assert.equal(preferenceCalls[0].baseServerRevision, 8);
  assert.equal(preferenceCalls[1].baseServerRevision, 9);
  assert.equal(sync.getSnapshot().pendingMutationCount, 1);

  sync.destroy();
  preferenceSync.destroy();
});


test("invalid remote portable preferences fail closed instead of weakening the preference contract", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-invalid-remote"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return {
        cursor: 70,
        objects: [
          {
            objectId: "preferences/surface",
            dataClass: "preferences",
            objectSchemaVersion: 1,
            resolverVersion: 1,
            serverRevision: 1,
            tombstone: false,
            payload: {
              "accessibility.contrast": "standard",
              "accessibility.motion": "full",
              "accessibility.text-scale": "standard",
            },
          },
        ],
      };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation() {
      throw new Error("invalid remote state must not be acknowledged or rewritten automatically");
    },
  };

  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-invalid-remote"),
  });

  await sync.refresh();

  assert.equal(sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(preferences.getSnapshot()["accessibility.motion"], "standard");

  sync.destroy();
  preferenceSync.destroy();
});


test("Memory capture, Surface favorites and color palette remain device-local and are not queued for account sync", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-memory-local"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const applied = [];
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return { cursor: 0, objects: [] };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(value) {
      applied.push(value);
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
        changeCursor: 1,
      };
    },
  };
  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpointStore(),
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-memory-local"),
  });

  await sync.refresh();
  applied.length = 0;
  preferences.set("memory.auto-capture", "off");
  preferences.set("surface.favorite-shortcuts", "files,store");
  preferences.set("surface.color-palette", "native");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(preferences.getSnapshot()["memory.auto-capture"], "off");
  assert.equal(preferences.getSnapshot()["surface.favorite-shortcuts"], "files,store");
  assert.equal(applied.some((item) => item.objectId === "preferences/surface"), false);

  sync.destroy();
  preferenceSync.destroy();
});

test("late account A snapshot cannot overwrite B and B reconciliation is retried", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-identity-race"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  let current = { state: "signed-in", subjectId: "account-A", displayName: "A" };
  const listeners = new Set();
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    change(subjectId) {
      current = { state: "signed-in", subjectId, displayName: subjectId };
      for (const listener of [...listeners]) listener(current);
    },
  };
  const replies = [];
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    snapshot: () => new Promise(resolve => replies.push(resolve)),
    pullChanges: async ({ afterCursor }) => ({ nextCursor: afterCursor, changes: [] }),
    applyMutation: async value => ({
      $schema: "prototype-ordax.sync-ack/1",
      objectId: value.objectId,
      dataClass: value.dataClass,
      serverRevision: value.baseServerRevision + 1,
      tombstone: false,
      applied: true,
      conflict: false,
    }),
  };
  const sync = createAccountSyncRuntime({
    identitySession: identity, transport,
    preferenceSync, preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("sync-race"),
  });
  assert.equal(replies.length, 1);
  identity.change("account-B");
  replies[0]({ cursor: 1, objects: [{
    objectId: "preferences/surface", dataClass: "preferences",
    objectSchemaVersion: 1, resolverVersion: 1, serverRevision: 1,
    tombstone: false,
    payload: { "accessibility.contrast": "high", "accessibility.motion": "reduced", "accessibility.text-scale": "large" },
  }] });
  for (let i = 0; i < 15 && replies.length < 2; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(replies.length, 2, "B must start a new authoritative snapshot after A settles");
  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "standard", "A's delayed data cannot become B's");
  replies[1]({ cursor: 2, objects: [{
    objectId: "preferences/surface", dataClass: "preferences",
    objectSchemaVersion: 1, resolverVersion: 1, serverRevision: 1,
    tombstone: false,
    payload: { "accessibility.contrast": "high", "accessibility.motion": "standard", "accessibility.text-scale": "standard" },
  }] });
  await sync.refresh();
  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "high");
  assert.equal(preferences.getSnapshot()["accessibility.motion"], "standard");
  assert.equal(sync.getSnapshot().accountContinuity, "active");
  sync.destroy();
  preferenceSync.destroy();
});

test("offline sign-out during a portable mutation discards its late ACK", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref-late-ack"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const listeners = new Set();
  let session = { state: "signed-in", subjectId: "account-A", displayName: "A" };
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => session,
    subscribe(listener) {
      listeners.add(listener);
      listener(session);
      return () => listeners.delete(listener);
    },
    signOut() {
      session = { state: "signed-out" };
      for (const listener of [...listeners]) listener(session);
    },
  };
  let releasePending;
  const sent = [];
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    snapshot: async () => ({ cursor: 1, objects: [] }),
    pullChanges: async ({ afterCursor }) => ({ nextCursor: afterCursor, changes: [] }),
    applyMutation(value) {
      sent.push(value);
      const ack = {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false, applied: true, conflict: false,
      };
      if (value.objectId === "preferences/surface"
        && value.payload["accessibility.contrast"] === "high") {
        return new Promise(resolve => { releasePending = () => resolve(ack); });
      }
      return Promise.resolve(ack);
    },
  };
  const sync = createAccountSyncRuntime({
    identitySession: identity, transport,
    preferenceSync, preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account-late-ack"),
  });
  await sync.refresh();
  preferences.set("accessibility.contrast", "high");
  for (let i = 0; i < 20 && !releasePending; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(typeof releasePending, "function", "the A mutation must be in flight");
  const submitted = sent.length;
  identity.signOut();
  releasePending();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(sync.getSnapshot().pendingMutationCount, 0,
    "signed-out state must not expose another account's queue");
  assert.equal(sent.length, submitted, "no subsequent remote mutation is sent after logout");
  sync.destroy();
  preferenceSync.destroy();
});

function partitionedPhysicalStore(initial = null) {
  let raw = initial;
  let accepts = true;
  return {
    schema: SYNC_STATE_STORE_SCHEMA, scope: "device",
    load: () => raw,
    save(value) {
      if (!accepts) return false;
      raw = value;
      return true;
    },
    async flush() { return accepts; },
    rejectWrites(value) { accepts = value !== true; },
    read: () => raw,
  };
}

function changingIdentity() {
  let state = { state: "signed-out" };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    change(subjectId) {
      state = subjectId === null ? { state: "signed-out" }
        : { state: "signed-in", subjectId, displayName: subjectId };
      for (const listener of [...listeners]) listener(state);
    },
  };
}

test("account A offline appearance and portable intent stays partitioned across B sign-in and restart", async () => {
  const root = partitionedPhysicalStore();
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const identity = changingIdentity();
  const preferences = preferencesRuntime();
  const workspace = createWorkspaceMetadataBridge(workspaceStore());
  let online = false;
  const transmissions = [];
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() { return { cursor: 0, objects: [] }; },
    async pullChanges({ afterCursor }) { return { nextCursor: afterCursor, changes: [] }; },
    async applyMutation(entry) {
      transmissions.push({ subject: identity.getSnapshot().subjectId, entry });
      if (!online) throw new Error("offline transport");
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: entry.objectId, dataClass: entry.dataClass,
        serverRevision: entry.baseServerRevision + 1,
        applied: true, conflict: false, tombstone: false,
      };
    },
  };
  const makeRuntime = prefix => {
    const appearance = createPreferenceSyncRuntime(preferences, {
      identitySession: identity, syncStateRegistry: registry,
      createIdempotencyKey: keyFactory(prefix + "-appearance"),
    });
    const account = createAccountSyncRuntime({
      identitySession: identity, syncStateRegistry: registry,
      transport, preferenceSync: appearance, preferences,
      workspaceMetadataSource: workspace.source, workspaceStore: workspace.store,
      createIdempotencyKey: keyFactory(prefix + "-portable"),
    });
    return { appearance, account, destroy() { account.destroy(); appearance.destroy(); } };
  };
  const first = makeRuntime("first");
  preferences.set("appearance.theme", "dark");
  preferences.set("accessibility.contrast", "high");
  assert.equal(first.appearance.pendingMutations().length, 0, "guest theme is not cloud intent");
  assert.equal(first.account.getSnapshot().pendingMutationCount, 0, "guest edits are local");

  identity.change("account-A");
  await first.account.refresh();
  assert.equal(transmissions.length, 0, "A login cannot upload previous guest state");

  preferences.set("appearance.theme", "light");
  preferences.set("accessibility.contrast", "standard");
  workspace.store.save({ ...workspace.store.load(), activeAreaId: "area-2" });
  await new Promise(resolve => setImmediate(resolve));
  const pendingA = registry.open("portable-pending", { partitionKey: "account-A" }).load();
  assert.ok(pendingA, "A's pending portable intent must use its own durable slot");
  assert.deepEqual(JSON.parse(pendingA).mutations.map(x => x.objectId).sort(), [
    "preferences/surface", "workspace/portable",
  ]);
  assert.ok(registry.open("appearance", { partitionKey: "account-A" }).load());
  const mutationA = first.appearance.pendingMutations();
  assert.equal(mutationA.length, 1);

  identity.change(null);
  assert.equal(first.appearance.pendingMutations().length, 0);
  assert.equal(first.account.getSnapshot().pendingMutationCount, 0);
  identity.change("account-B");
  await first.account.refresh();
  assert.equal(first.appearance.pendingMutations().length, 0);
  assert.equal(first.account.getSnapshot().pendingMutationCount, 0);
  assert.equal(registry.open("portable-pending", { partitionKey: "account-B" }).load(), null);
  assert.equal(transmissions.filter(x => x.subject === "account-B").length, 0,
    "A or guest payload must not leak into B's empty account");

  first.destroy();
  const rebooted = makeRuntime("rebooted");
  identity.change(null);
  identity.change("account-A");
  await rebooted.account.refresh();
  assert.equal(rebooted.appearance.pendingMutations().length, 1);
  assert.deepEqual(rebooted.appearance.pendingMutations()[0], mutationA[0],
    "restart must restore A's precise theme intent and idempotency key");
  assert.ok(registry.open("portable-pending", { partitionKey: "account-A" }).load());
  online = true;
  await rebooted.account.flush();
  const after = transmissions.filter(x => x.subject === "account-A");
  assert.ok(after.some(x => x.entry.objectId === "preferences/surface"));
  assert.ok(after.some(x => x.entry.objectId === "workspace/portable"));
  assert.ok(after.some(x => x.entry.objectId === "appearance/theme"));
  assert.equal(transmissions.some(x => x.subject === "account-B"), false);
  rebooted.destroy();
});

test("legacy unscoped appearance slot is never replayed as an authenticated account mutation", async () => {
  const legacy = JSON.stringify({
    $schema: "ordax.preference-sync-state/1", serverRevision: 1,
    mutations: [{
      $schema: "ordax.sync-mutation/1", operation: "upsert",
      objectId: "appearance/theme", dataClass: "appearance",
      objectSchemaVersion: 1, baseServerRevision: 1,
      idempotencyKey: "legacy:theme:01", payload: { theme: "dark" },
    }],
  });
  const registry = createSyncStateNamespaceRegistry(partitionedPhysicalStore(legacy), {
    legacyNamespace: "appearance",
  });
  const identity = changingIdentity();
  const preferences = preferencesRuntime();
  const appearance = createPreferenceSyncRuntime(preferences, {
    identitySession: identity, syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("legacy-proof"),
  });
  identity.change("account-B");
  assert.equal(appearance.pendingMutations().length, 0);
  assert.equal(registry.open("appearance").load(), legacy, "legacy data is retained for explicit recovery");
  appearance.destroy();
});

test("a refused device write never authorizes offline pending appearance or portable upload", async () => {
  let raw = null, allowSave = true;
  const root = {
    schema: SYNC_STATE_STORE_SCHEMA, scope: "device",
    load: () => raw,
    save(value) {
      if (!allowSave) return false;
      raw = value;
      return true;
    },
    async flush() { return true; }, // Host ACK of old state must not validate a rejected save.
  };
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const identity = changingIdentity();
  const preferences = preferencesRuntime();
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  let sent = 0;
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() { return { cursor: 0, objects: [] }; },
    async pullChanges({ afterCursor }) { return { nextCursor: afterCursor, changes: [] }; },
    async applyMutation(value) {
      sent++;
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId, dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        applied: true, conflict: false, tombstone: false,
      };
    },
  };
  const appearance = createPreferenceSyncRuntime(preferences, {
    identitySession: identity, syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("reject-appearance"),
  });
  const account = createAccountSyncRuntime({
    identitySession: identity, syncStateRegistry: registry,
    preferenceSync: appearance, transport, preferences,
    workspaceMetadataSource: bridge.source, workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("reject-portable"),
  });
  identity.change("account-A");
  await account.refresh();
  allowSave = false;
  preferences.set("appearance.theme", "dark");
  preferences.set("accessibility.contrast", "high");
  await new Promise(resolve => setImmediate(resolve));
  await account.flush();
  assert.equal(sent, 0, "rejected Native state saves must prevent remote mutations");
  assert.equal(appearance.pendingMutations().length, 1);
  assert.equal(account.getSnapshot().queuePersistence, "session");
  account.destroy();
  appearance.destroy();
});

test("corrupt subject-bound portable queue prevents replay without destroying its evidence", async () => {
  const root = partitionedPhysicalStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const corrupted = registry.open("portable-pending", { partitionKey: "account-A" });
  corrupted.save("{invalid-portable-queue");
  const identity = changingIdentity();
  const prefs = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(prefs, {
    identitySession: identity, syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("corrupt-pref"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  let requests = 0;
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() { requests++; return { cursor: 0, objects: [] }; },
    async pullChanges({ afterCursor }) { requests++; return { nextCursor: afterCursor, changes: [] }; },
    async applyMutation() { requests++; throw Error("must not replay"); },
  };
  const sync = createAccountSyncRuntime({
    identitySession: identity, syncStateRegistry: registry,
    preferenceSync, preferences: prefs, transport,
    workspaceMetadataSource: bridge.source, workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("corrupt-portable"),
  });
  identity.change("account-A");
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(requests, 0, "corruption must fail closed before any transport request");
  assert.equal(corrupted.load(), "{invalid-portable-queue");
  sync.destroy();
  preferenceSync.destroy();
});

test("portable conflict rebase waits for durable ACK before sending a new idempotency key", async () => {
  let raw = null, sends = 0;
  const physical = {
    schema: SYNC_STATE_STORE_SCHEMA, scope: "device",
    load: () => raw,
    save(value) { raw = value; return true; },
    async flush() { return !String(raw).includes("preferences-rebase"); },
  };
  const registry = createSyncStateNamespaceRegistry(physical);
  const identity = changingIdentity();
  const preferences = preferencesRuntime();
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const appearance = createPreferenceSyncRuntime(preferences, {
    identitySession: identity, syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("conflict-pref"),
  });
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() { return { cursor: 0, objects: [] }; },
    async pullChanges({ afterCursor }) { return { nextCursor: afterCursor, changes: [] }; },
    async applyMutation(value) {
      sends++;
      assert.equal(value.objectId, "preferences/surface");
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId, dataClass: value.dataClass,
        serverRevision: 1, tombstone: false, applied: false, conflict: true,
      };
    },
  };
  const sync = createAccountSyncRuntime({
    identitySession: identity, syncStateRegistry: registry,
    preferenceSync: appearance, preferences, transport,
    workspaceMetadataSource: bridge.source, workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("conflict-check"),
  });
  identity.change("account-A");
  await sync.refresh();
  preferences.set("accessibility.contrast", "high");
  await new Promise(resolve => setImmediate(resolve));
  await sync.flush();
  assert.equal(sends, 1, "rebase must not retry before the new queue is durable");
  const record = registry.open("portable-pending", { partitionKey: "account-A" }).load();
  assert.ok(record?.includes("preferences-rebase"), "rebased pending intent remains staged");
  sync.destroy();
  appearance.destroy();
});

test("missing Native durable registry keeps account queues subject-bound only for this session", async () => {
  const identity = changingIdentity();
  const preferences = preferencesRuntime();
  const appearance = createPreferenceSyncRuntime(preferences, {
    identitySession: identity,
    syncStateRegistry: null,
    createIdempotencyKey: keyFactory("volatile-native"),
  });
  preferences.set("appearance.theme", "dark");
  assert.equal(appearance.pendingMutations().length, 0, "guest remains local without Native store");
  identity.change("account-A");
  preferences.set("appearance.theme", "light");
  assert.equal(appearance.pendingMutations().length, 1);
  const ownerA = appearance.pendingMutations()[0];
  assert.equal(await appearance.flushDurably(), false,
    "session fallback must never report a device-durable cloud mutation");
  identity.change(null);
  identity.change("account-B");
  assert.equal(appearance.pendingMutations().length, 0);
  identity.change("account-A");
  assert.deepEqual(appearance.pendingMutations(), [ownerA],
    "A's in-memory queue is protected without borrowing another account's identity");
  appearance.destroy();
});

test("corrupt account appearance state stays intact and cannot be replayed or overwritten", async () => {
  const root = partitionedPhysicalStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const slot = registry.open("appearance", { partitionKey: "account-A" });
  slot.save("{corrupt-appearance");
  const identity = changingIdentity();
  const prefs = preferencesRuntime();
  const appearance = createPreferenceSyncRuntime(prefs, {
    identitySession: identity, syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("corrupt-appearance"),
  });
  identity.change("account-A");
  assert.equal(await appearance.flushDurably(), false);
  prefs.set("appearance.theme", "dark");
  assert.equal(appearance.pendingMutations().length, 0);
  assert.equal(slot.load(), "{corrupt-appearance");
  assert.throws(() => appearance.applyRemoteAppearance({
    $schema: "ordax.sync-object/1", objectId: "appearance/theme",
    dataClass: "appearance", objectSchemaVersion: 1, serverRevision: 1,
    tombstone: false, payload: { theme: "light" },
  }), /requires explicit recovery/);
  identity.change("account-B");
  assert.equal(await appearance.flushDurably(), true);
  identity.change("account-A");
  assert.equal(await appearance.flushDurably(), false);
  assert.equal(slot.load(), "{corrupt-appearance");
  appearance.destroy();
});

test("refused remote workspace restore cannot advance snapshot or incremental checkpoints", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("refused-workspace"),
  });
  let accepted = false;
  let workspace = createDefaultWorkspaceRecord();
  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load: () => workspace,
    save(next) {
      if (!accepted) return false;
      workspace = validateWorkspaceRecord(next);
      return true;
    },
  };
  const bridge = createWorkspaceMetadataBridge(store);
  const checkpoints = checkpointStore();
  const workspaceObject = (revision, appId) => ({
    objectId: "workspace/portable",
    dataClass: "workspace-metadata",
    objectSchemaVersion: 1,
    resolverVersion: 1,
    serverRevision: revision,
    tombstone: false,
    payload: {
      activeAreaId: "area-1",
      areas: [
        { id: "area-1", ordinal: 1, appIds: [appId] },
        { id: "area-2", ordinal: 2, appIds: [] },
      ],
    },
  });
  const first = workspaceObject(3, "files");
  const second = workspaceObject(4, "settings");
  let pullCount = 0;
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() { return { cursor: 11, objects: [first] }; },
    async pullChanges({ afterCursor }) {
      if (afterCursor === 11) {
        pullCount += 1;
        return { afterCursor, nextCursor: 12, changes: [second] };
      }
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation() { throw new Error("Unexpected upload during restore proof"); },
  };
  const sync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport, checkpointStore: checkpoints, preferenceSync, preferences,
    workspaceMetadataSource: bridge.source, workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("refused-workspace-account"),
  });
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(checkpoints.peek(), null, "rejected initial restore must not publish any cursor");
  assert.equal(bridge.source.getSnapshot().areas[0].appIds.length, 0);

  accepted = true;
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "active");
  assert.deepEqual(bridge.source.getSnapshot().areas[0].appIds, ["files"]);

  accepted = false;
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "not-active");
  assert.deepEqual(bridge.source.getSnapshot().areas[0].appIds, ["files"]);
  assert.equal(pullCount, 1, "first incremental attempt must reach the refused workspace");

  accepted = true;
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "active");
  assert.deepEqual(bridge.source.getSnapshot().areas[0].appIds, ["settings"],
    "same remote revision must be retried after the denied write is fixed");
  assert.ok(pullCount >= 2, "failed incremental page must be retried, not skipped");
  sync.destroy();
  preferenceSync.destroy();
});

test("identity owner switch is not a workspace edit: B remote workspace restores without A upload", async () => {
  const identity = changingIdentity();
  const map = new Map();
  const native = createNativeWorkspaceStore({ localStorage: {
    getItem: key => map.get(key) ?? null,
    setItem(key, value) { map.set(key, String(value)); },
  } });
  const bridge = createWorkspaceMetadataBridge(native);
  // Native composition registers workspace rescoping before Account Sync.
  const stopRescope = identity.subscribe(snapshot => {
    if (native.selectOwner(snapshot)) bridge.store.load();
  });
  const preferences = preferencesRuntime();
  const appearance = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("identity-workspace-appearance"),
  });
  const uploads = [];
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      if (identity.getSnapshot().subjectId !== "account-B") return { cursor: 1, objects: [] };
      return {
        cursor: 15, objects: [{
          objectId: "workspace/portable",
          dataClass: "workspace-metadata", objectSchemaVersion: 1,
          resolverVersion: 1, serverRevision: 4, tombstone: false,
          payload: {
            activeAreaId: "area-1",
            areas: [
              { id: "area-1", ordinal: 1, appIds: ["settings"] },
              { id: "area-2", ordinal: 2, appIds: [] },
            ],
          },
        }],
      };
    },
    async pullChanges({ afterCursor }) { return { nextCursor: afterCursor, changes: [] }; },
    async applyMutation(value) {
      uploads.push({ subject: identity.getSnapshot().subjectId, objectId: value.objectId });
      return {
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId, dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        applied: true, conflict: false, tombstone: false,
      };
    },
  };
  const sync = createAccountSyncRuntime({
    identitySession: identity, transport, checkpointStore: checkpointStore(),
    preferenceSync: appearance, preferences,
    workspaceMetadataSource: bridge.source, workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("identity-workspace-account"),
  });

  identity.change("account-A");
  await sync.refresh();
  const base = createDefaultWorkspaceRecord();
  bridge.store.save({
    ...base,
    areas: [{
      ...base.areas[0],
      windows: [{
        id: "files", appId: "files", minimized: false, maximized: false,
        placementOrdinal: 1, positionX: null, positionY: null,
        target: "/private-A",
      }],
      activeWindowId: "files", nextWindowOrdinal: 2,
    }, base.areas[1]],
  });
  assert.deepEqual(bridge.source.getSnapshot().areas[0].appIds, ["files"]);

  identity.change("account-B");
  await sync.refresh();
  assert.equal(sync.getSnapshot().accountContinuity, "active");
  assert.deepEqual(bridge.source.getSnapshot().areas[0].appIds, ["settings"],
    "B's cloud workspace must win over B's fresh local partition");
  assert.equal(bridge.store.load().areas[0].windows[0].target, null,
    "B must never inherit A's local file target");
  assert.equal(uploads.some(x => x.subject === "account-B" && x.objectId === "workspace/portable"),
    false, "automated account switch is not cloud upload intent");

  identity.change("account-A");
  assert.equal(bridge.store.load().areas[0].windows[0].target, "/private-A",
    "A's local workspace remains in A's partition");
  sync.destroy();
  appearance.destroy();
  stopRescope();
});
