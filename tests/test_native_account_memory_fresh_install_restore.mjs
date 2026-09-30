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
import { createNativeAccountMemoryFoundation } from "../system/composition/native/account-memory-foundation.mjs";
import { createNativeAccountSyncRuntime } from "../system/composition/native/account-sync.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createPreferenceSnapshot, setPreferenceValue } from "../system/services/preferences/catalog.mjs";
import { createMemorySyncObject } from "../system/services/sync/account-memory-runtime.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";

const SUBJECT = "native-restore-user-1";
const REMOTE_CURSOR = 41;
const NOW = new Date("2026-09-30T15:30:00Z");

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

function entitlementWindow({ decision = "allowed", expiresAt = null } = {}) {
  return Object.freeze({
    async fetch(url, options) {
      assert.equal(url, "/account/entitlements/memory-cloud");
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "same-origin");
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
            expiresAt,
          });
        },
      });
    },
  });
}

function syncStateRootStore({ initial = null, events = [] } = {}) {
  let value = initial;
  return Object.freeze({
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => value,
    save(next) {
      events.push("coordination-save");
      value = next;
      return true;
    },
    async flush() {
      events.push("coordination-flush");
      return true;
    },
  });
}

function memoryStore({ events = [], flushResult = true } = {}) {
  let value = null;
  return Object.freeze({
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load: () => value,
    save(next) {
      events.push("memory-save");
      value = next;
      return true;
    },
    async flush() {
      events.push(flushResult ? "memory-flush" : "memory-flush-failed");
      return flushResult;
    },
  });
}

function checkpointStore(events = []) {
  let value = null;
  return Object.freeze({
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: "device",
    load: () => value,
    save(next) {
      events.push("checkpoint-save");
      value = next;
      return true;
    },
    peek: () => value,
  });
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
  return Object.freeze({
    schema: WORKSPACE_STORE_SCHEMA,
    load: () => snapshot,
    save(next) {
      snapshot = validateWorkspaceRecord(next);
      return true;
    },
  });
}

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function remoteMemory({ sensitivity = "private" } = {}) {
  return createMemorySyncObject({
    serverRevision: 9,
    item: {
      id: "restored-memory-1",
      ownerKind: "account",
      ownerId: SUBJECT,
      scope: "account",
      kind: "fact",
      sensitivity,
      content: "memória restaurada pela composição Native após instalação limpa",
      provenance: "user-confirmed:native-fresh-install-proof",
      sourceTimestamp: "2026-09-30T14:00:00Z",
      spaceId: null,
      projectId: null,
    },
  });
}

function accountSnapshotObjects(memoryObject = remoteMemory()) {
  return Object.freeze([
    Object.freeze({
      objectId: "appearance/theme",
      dataClass: "appearance",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 4,
      tombstone: false,
      payload: Object.freeze({ theme: "dark" }),
    }),
    Object.freeze({
      objectId: "preferences/surface",
      dataClass: "preferences",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 5,
      tombstone: false,
      payload: Object.freeze({
        "accessibility.contrast": "high",
        "accessibility.motion": "reduced",
        "accessibility.text-scale": "large",
      }),
    }),
    Object.freeze({
      objectId: "workspace/portable",
      dataClass: "workspace-metadata",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 7,
      tombstone: false,
      payload: Object.freeze({
        activeAreaId: "area-2",
        areas: Object.freeze([
          Object.freeze({ id: "area-1", ordinal: 1, appIds: Object.freeze(["files"]) }),
          Object.freeze({ id: "area-2", ordinal: 2, appIds: Object.freeze(["settings", "internet"]) }),
        ]),
      }),
    }),
    memoryObject,
  ]);
}

async function createHarness({
  entitlement = {},
  memoryObject = remoteMemory(),
  memoryFlushResult = true,
  coordinationInitial = null,
} = {}) {
  const events = [];
  const identity = identitySession();
  const memory = createMemoryRuntime({ store: memoryStore({ events, flushResult: memoryFlushResult }) });
  const registry = createSyncStateNamespaceRegistry(syncStateRootStore({ initial: coordinationInitial, events }));
  const foundation = createNativeAccountMemoryFoundation({
    windowRef: entitlementWindow(entitlement),
    identitySession: identity,
    memoryPort: memory,
    syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("native-memory"),
    now: () => NOW,
  });
  await foundation.settled();

  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("native-pref"),
  });
  const workspace = createWorkspaceMetadataBridge(workspaceStore());
  const checkpoint = checkpointStore(events);
  const mutations = [];
  const transport = Object.freeze({
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      events.push("remote-snapshot");
      return Object.freeze({ cursor: REMOTE_CURSOR, objects: accountSnapshotObjects(memoryObject) });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(value) {
      mutations.push(value);
      throw new Error("fresh-install restore must never echo remote state as a local mutation");
    },
  });

  const accountSync = createNativeAccountSyncRuntime({
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

  return Object.freeze({
    events,
    foundation,
    memory,
    preferences,
    workspace,
    checkpoint,
    mutations,
    accountSync,
    destroy() {
      accountSync.destroy();
      preferenceSync.destroy();
      foundation.destroy();
    },
  });
}

function accountMemory(harness) {
  return harness.memory.search({ ownerId: SUBJECT, scopes: ["account"] });
}

test("Native fresh install restores authorized portable Memory durably before advancing the account checkpoint", async () => {
  const harness = await createHarness();

  assert.equal(harness.checkpoint.peek(), null);
  assert.deepEqual(accountMemory(harness), []);

  await harness.accountSync.refresh();

  assert.equal(harness.mutations.length, 0);
  assert.equal(accountMemory(harness).length, 1);
  assert.equal(accountMemory(harness)[0].id, "restored-memory-1");
  assert.equal(harness.preferences.getSnapshot()["appearance.theme"], "dark");
  assert.equal(harness.workspace.source.getSnapshot().activeAreaId, "area-2");
  assert.equal(harness.checkpoint.peek().subjectId, SUBJECT);
  assert.equal(harness.checkpoint.peek().cursor, REMOTE_CURSOR);
  assert.equal(harness.accountSync.getSnapshot().accountContinuity, "active");
  assert.equal(harness.foundation.getSnapshot().productionPromoted, false);
  assert.equal(harness.foundation.getSnapshot().cloudTransportWired, false);

  const flushIndex = harness.events.indexOf("memory-flush");
  const checkpointIndex = harness.events.indexOf("checkpoint-save");
  assert.notEqual(flushIndex, -1);
  assert.notEqual(checkpointIndex, -1);
  assert.equal(flushIndex < checkpointIndex, true, "Memory durability must be confirmed before cursor checkpointing");

  harness.destroy();
});

test("Native fresh install fails closed for denied or expired inbound Memory entitlement", async () => {
  const cases = [
    { name: "denied", entitlement: { decision: "denied", expiresAt: null } },
    { name: "expired", entitlement: { decision: "allowed", expiresAt: "2026-09-30T15:00:00Z" } },
  ];

  for (const value of cases) {
    const harness = await createHarness({ entitlement: value.entitlement });
    await harness.accountSync.refresh();

    assert.equal(harness.checkpoint.peek(), null, `${value.name} entitlement must not advance checkpoint`);
    assert.deepEqual(accountMemory(harness), [], `${value.name} entitlement must not restore Memory`);
    assert.equal(harness.accountSync.getSnapshot().accountContinuity, "not-active");
    assert.equal(harness.mutations.length, 0);

    harness.destroy();
  }
});

test("Native fresh install rejects non-portable remote Memory without checkpoint advancement", async () => {
  const harness = await createHarness({ memoryObject: remoteMemory({ sensitivity: "restricted" }) });

  await harness.accountSync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.deepEqual(accountMemory(harness), []);
  assert.equal(harness.accountSync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.mutations.length, 0);

  harness.destroy();
});

test("Native fresh install never checkpoints Memory whose durable flush was not confirmed", async () => {
  const harness = await createHarness({ memoryFlushResult: false });

  await harness.accountSync.refresh();

  assert.equal(harness.events.includes("memory-save"), true);
  assert.equal(harness.events.includes("memory-flush-failed"), true);
  assert.equal(harness.events.includes("checkpoint-save"), false);
  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.accountSync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.mutations.length, 0);

  harness.destroy();
});

test("Native fresh install blocks remote Memory when coordination state requires recovery", async () => {
  const harness = await createHarness({
    coordinationInitial: JSON.stringify({ $schema: "ordax.unknown/1", slots: {} }),
  });

  assert.equal(harness.foundation.getSnapshot().state, "recovery-required");
  assert.equal(harness.foundation.memorySync, null);

  await harness.accountSync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.deepEqual(accountMemory(harness), []);
  assert.equal(harness.accountSync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.mutations.length, 0);

  harness.destroy();
});
