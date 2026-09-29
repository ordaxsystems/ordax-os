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
import { createAccountSyncRuntime } from "../system/services/sync/account-runtime.mjs";

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


test("Memory automatic capture preference remains device-local and is not queued for account sync", async () => {
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
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(preferences.getSnapshot()["memory.auto-capture"], "off");
  assert.equal(applied.some((item) => item.objectId === "preferences/surface"), false);

  sync.destroy();
  preferenceSync.destroy();
});
