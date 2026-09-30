import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { SYNC_CHECKPOINT_STORE_SCHEMA } from "../system/contracts/sync-checkpoint-store.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  createDefaultWorkspaceRecord,
  validateWorkspaceRecord,
} from "../system/contracts/workspace-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createPreferenceSnapshot, setPreferenceValue } from "../system/services/preferences/catalog.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import { createMemorySyncObject } from "../system/services/sync/account-memory-runtime.mjs";
import { createNativeAccountMemoryFoundation } from "../system/composition/native/account-memory-foundation.mjs";
import { createNativeAccountSyncRuntime } from "../system/composition/native/account-sync.mjs";

const SUBJECT = "native-restore-user-1";
const MEMORY_ID = "0f3d48bc-bf35-4af6-8b8f-339862ec4f61";

function identitySession() {
  const snapshot = Object.freeze({ state: "signed-in", subjectId: SUBJECT, displayName: "Pessoa" });
  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  });
}

function preferencesRuntime() {
  let snapshot = createPreferenceSnapshot();
  const listeners = new Set();
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    set(id, value) {
      snapshot = setPreferenceValue(snapshot, id, value);
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

function durableMemoryStore(events, { failFlush = false } = {}) {
  let staged = null;
  let durable = null;
  return {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load: () => durable,
    save(value) {
      staged = value;
      events.push("memory-save");
      return true;
    },
    async flush() {
      events.push("memory-flush");
      if (failFlush) throw new Error("memory durability unavailable");
      durable = staged;
      return true;
    },
    peek: () => durable,
  };
}

function rootSyncStateStore() {
  let value = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => value,
    save(next) {
      value = next;
      return true;
    },
    async flush() {
      return true;
    },
  };
}

function checkpointStore(events) {
  let staged = null;
  let durable = null;
  return {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: "device",
    load: () => durable,
    save(next) {
      staged = next;
      events.push("checkpoint-save");
      return true;
    },
    async flush() {
      events.push("checkpoint-flush");
      durable = staged;
      return true;
    },
    peek: () => durable,
  };
}

function entitlementWindow(calls, { decision = "allowed" } = {}) {
  return Object.freeze({
    async fetch(url, options) {
      calls.push({ url, options });
      return Object.freeze({
        ok: true,
        status: 200,
        async json() {
          return Object.freeze({
            subjectType: "account",
            subjectId: SUBJECT,
            key: "memory.cloud.enabled",
            decision,
            value: null,
            authority: "server",
            expiresAt: null,
          });
        },
      });
    },
  });
}

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function remoteMemory() {
  return createMemorySyncObject({
    serverRevision: 9,
    item: {
      id: MEMORY_ID,
      ownerKind: "account",
      ownerId: SUBJECT,
      scope: "account",
      kind: "fact",
      sensitivity: "private",
      content: "memória restaurada pela composição Native real",
      provenance: "user-confirmed:native-fresh-install-proof",
      sourceTimestamp: "2026-09-30T20:10:00Z",
      spaceId: null,
      projectId: null,
    },
  });
}

function nonPortableRemoteMemory() {
  const valid = remoteMemory();
  return Object.freeze({
    ...valid,
    payload: Object.freeze({
      ...valid.payload,
      memory: Object.freeze({
        ...valid.payload.memory,
        sensitivity: "restricted",
      }),
    }),
  });
}

function remoteObjects(memoryObject = remoteMemory()) {
  return [
    {
      objectId: "appearance/theme",
      dataClass: "appearance",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 4,
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
          { id: "area-2", ordinal: 2, appIds: ["settings", "internet"] },
        ],
      },
    },
    memoryObject,
  ];
}

function createNativeRestoreHarness({
  entitlementDecision = "allowed",
  memoryObject = remoteMemory(),
  failMemoryFlush = false,
} = {}) {
  const events = [];
  const entitlementCalls = [];
  const transportMutations = [];
  const identity = identitySession();
  const memoryStore = durableMemoryStore(events, { failFlush: failMemoryFlush });
  const memory = createMemoryRuntime({ store: memoryStore });
  const registry = createSyncStateNamespaceRegistry(rootSyncStateStore());

  const foundation = createNativeAccountMemoryFoundation({
    windowRef: entitlementWindow(entitlementCalls, { decision: entitlementDecision }),
    identitySession: identity,
    memoryPort: memory,
    syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("native-memory"),
  });

  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("native-preference"),
  });
  const workspace = createWorkspaceMetadataBridge(workspaceStore());
  const checkpoint = checkpointStore(events);

  let snapshotCalls = 0;
  let pullCalls = 0;
  const transport = Object.freeze({
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      snapshotCalls += 1;
      return Object.freeze({ cursor: 44, objects: Object.freeze(remoteObjects(memoryObject)) });
    },
    async pullChanges({ afterCursor }) {
      pullCalls += 1;
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(value) {
      transportMutations.push(value);
      throw new Error("fresh Native restore must not echo remote Memory as a local mutation");
    },
  });

  const sync = createNativeAccountSyncRuntime({
    accountMemoryFoundation: foundation,
    identitySession: identity,
    transport,
    checkpointStore: checkpoint,
    preferenceSync,
    preferences,
    workspaceMetadataSource: workspace.source,
    workspaceStore: workspace.store,
    createIdempotencyKey: keyFactory("native-account"),
  });

  return {
    events,
    entitlementCalls,
    transportMutations,
    memory,
    memoryStore,
    foundation,
    checkpoint,
    sync,
    counters: () => ({ snapshotCalls, pullCalls }),
    destroy() {
      sync.destroy();
      preferenceSync.destroy();
      foundation.destroy();
    },
  };
}

test("Native fresh-install composition restores authorized portable Memory before durable checkpoint without echo", async () => {
  const harness = createNativeRestoreHarness();

  assert.equal(harness.memoryStore.peek(), null, "fresh install starts with empty durable Memory");
  assert.equal(harness.checkpoint.peek(), null, "fresh install starts with empty account checkpoint");

  await harness.foundation.settled();
  await harness.sync.refresh();

  assert.equal(harness.entitlementCalls.length, 1);
  assert.equal(harness.entitlementCalls[0].url, "/account/entitlements/memory-cloud");
  assert.deepEqual(harness.counters(), { snapshotCalls: 1, pullCalls: 0 });
  assert.equal(harness.transportMutations.length, 0);

  const restored = harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, MEMORY_ID);
  assert.equal(restored[0].content, "memória restaurada pela composição Native real");

  const memoryFlush = harness.events.indexOf("memory-flush");
  const checkpointFlush = harness.events.indexOf("checkpoint-flush");
  assert.notEqual(memoryFlush, -1);
  assert.notEqual(checkpointFlush, -1);
  assert.equal(memoryFlush < checkpointFlush, true, "Memory durability must precede checkpoint durability");

  assert.equal(harness.checkpoint.peek().subjectId, SUBJECT);
  assert.equal(harness.checkpoint.peek().cursor, 44);
  assert.equal(harness.foundation.memorySync.getSnapshot().pendingMutationCount, 0);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "active");

  harness.destroy();
});

test("Native fresh-install restore denies remote Memory when server entitlement is denied", async () => {
  const harness = createNativeRestoreHarness({ entitlementDecision: "denied" });

  await harness.foundation.settled();
  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.deepEqual(
    harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }),
    [],
  );
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.transportMutations.length, 0);

  harness.destroy();
});

test("Native fresh-install restore rejects non-portable Memory before checkpoint advancement", async () => {
  const harness = createNativeRestoreHarness({
    memoryObject: nonPortableRemoteMemory(),
  });

  await harness.foundation.settled();
  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.deepEqual(
    harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }),
    [],
  );
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.transportMutations.length, 0);

  harness.destroy();
});

test("Native fresh-install restore never advances checkpoint when Memory durability fails", async () => {
  const harness = createNativeRestoreHarness({ failMemoryFlush: true });

  await harness.foundation.settled();
  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.transportMutations.length, 0);
  assert.equal(harness.events.includes("checkpoint-flush"), false);

  harness.destroy();
});
