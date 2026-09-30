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
import {
  createPreferenceSnapshot,
  setPreferenceValue,
} from "../system/services/preferences/catalog.mjs";
import {
  createMemorySyncObject,
} from "../system/services/sync/account-memory-runtime.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { createNativeAccountMemoryFoundation } from "../system/composition/native/account-memory-foundation.mjs";
import { createNativeAccountSyncRuntime } from "../system/composition/native/account-sync.mjs";

const SUBJECT = "native-restore-account";
const CURSOR = 41;

function identitySession() {
  const snapshot = Object.freeze({
    state: "signed-in",
    subjectId: SUBJECT,
    displayName: "Conta Restore",
  });
  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe() {
      return () => {};
    },
  });
}

function preferencesRuntime() {
  let snapshot = createPreferenceSnapshot();
  const listeners = new Set();
  return Object.freeze({
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
      return () => listeners.delete(listener);
    },
  });
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

function memoryStore(events, { failFlush = false } = {}) {
  let staged = null;
  let durable = null;
  return Object.freeze({
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load: () => durable,
    save(next) {
      staged = next;
      events.push("memory-save");
      return true;
    },
    async flush() {
      events.push("memory-flush");
      if (failFlush) throw new Error("memory durability unavailable");
      durable = staged;
      return true;
    },
    durableSnapshot: () => durable,
  });
}

function rootSyncStateStore(initial = null) {
  let payload = initial;
  return Object.freeze({
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(next) {
      payload = next;
      return true;
    },
    async flush() {
      return true;
    },
  });
}

function checkpointStore(events) {
  let staged = null;
  let durable = null;
  return Object.freeze({
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
  });
}

function entitlementWindow({
  decision = "allowed",
  expiresAt = null,
  unavailable = false,
} = {}) {
  const calls = [];
  return Object.freeze({
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      if (unavailable) {
        return Object.freeze({ ok: false, status: 503, async json() { return {}; } });
      }
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

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:runtime-proof`;
}

function remoteMemory({ sensitivity = "private" } = {}) {
  return createMemorySyncObject({
    serverRevision: 12,
    item: {
      id: "restored-native-memory",
      ownerKind: "account",
      ownerId: SUBJECT,
      scope: "account",
      kind: "fact",
      sensitivity,
      content: "memória portátil restaurada pela composição Native real",
      provenance: "runtime-restore-proof",
      sourceTimestamp: "2026-09-30T19:20:00Z",
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

function snapshotObjects(memoryObject = remoteMemory()) {
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
        activeAreaId: "area-1",
        areas: Object.freeze([
          Object.freeze({ id: "area-1", ordinal: 1, appIds: Object.freeze(["files"]) }),
        ]),
      }),
    }),
    memoryObject,
  ]);
}

function transport(objects, calls) {
  return Object.freeze({
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      calls.push("snapshot");
      return Object.freeze({ cursor: CURSOR, objects });
    },
    async pullChanges({ afterCursor }) {
      calls.push("pull");
      return Object.freeze({
        afterCursor,
        nextCursor: afterCursor,
        changes: Object.freeze([]),
      });
    },
    async applyMutation(value) {
      calls.push(`mutation:${value.dataClass}`);
      throw new Error("fresh restore must not echo remote state");
    },
  });
}

async function createHarness({
  entitlement = {},
  memoryOptions = {},
  memoryObject = remoteMemory(),
  rootInitial = null,
  settleFoundation = true,
} = {}) {
  const events = [];
  const transportCalls = [];
  const identity = identitySession();
  const windowRef = entitlementWindow(entitlement);
  const store = memoryStore(events, memoryOptions);
  const memory = createMemoryRuntime({ store });
  const registry = createSyncStateNamespaceRegistry(rootSyncStateStore(rootInitial));
  const foundation = createNativeAccountMemoryFoundation({
    windowRef,
    identitySession: identity,
    memoryPort: memory,
    syncStateRegistry: registry,
    createIdempotencyKey: keyFactory("native-memory"),
  });
  if (settleFoundation) await foundation.settled();

  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("native-pref"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const checkpoint = checkpointStore(events);
  const sync = createNativeAccountSyncRuntime({
    accountMemoryFoundation: foundation,
    identitySession: identity,
    transport: transport(snapshotObjects(memoryObject), transportCalls),
    checkpointStore: checkpoint,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("native-account"),
  });

  return Object.freeze({
    events,
    transportCalls,
    windowRef,
    store,
    memory,
    foundation,
    checkpoint,
    sync,
    destroy() {
      sync.destroy();
      preferenceSync.destroy();
      foundation.destroy();
    },
  });
}

test("Native fresh-install restore persists authorized Memory before advancing a durable account checkpoint", async () => {
  const harness = await createHarness();

  assert.deepEqual(
    harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }),
    [],
  );
  assert.equal(harness.checkpoint.peek(), null);

  await harness.sync.refresh();

  const restored = harness.memory.search({
    ownerKind: "account",
    ownerId: SUBJECT,
    scopes: ["account"],
  });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "restored-native-memory");
  assert.equal(harness.checkpoint.peek().subjectId, SUBJECT);
  assert.equal(harness.checkpoint.peek().cursor, CURSOR);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "active");
  assert.equal(harness.transportCalls.filter((entry) => entry.startsWith("mutation:")).length, 0);
  assert.equal(harness.windowRef.calls.length >= 1, true);
  assert.equal(harness.windowRef.calls[0].url, "/account/entitlements/memory-cloud");

  const memoryFlush = harness.events.indexOf("memory-flush");
  const checkpointFlush = harness.events.lastIndexOf("checkpoint-flush");
  assert.notEqual(memoryFlush, -1);
  assert.notEqual(checkpointFlush, -1);
  assert.equal(memoryFlush < checkpointFlush, true, "Memory durability must precede checkpoint durability");

  harness.destroy();
});

for (const entitlement of [
  { decision: "denied" },
  { decision: "allowed", expiresAt: "2026-09-29T00:00:00Z" },
  { unavailable: true },
]) {
  const label = entitlement.unavailable
    ? "unavailable"
    : (entitlement.expiresAt ? "expired" : entitlement.decision);
  test(`Native fresh-install restore fails closed when Memory entitlement is ${label}`, async () => {
    const harness = await createHarness({ entitlement });

    await harness.sync.refresh();

    assert.deepEqual(
      harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }),
      [],
    );
    assert.equal(harness.checkpoint.peek(), null);
    assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
    assert.equal(harness.transportCalls.filter((entry) => entry.startsWith("mutation:")).length, 0);

    harness.destroy();
  });
}

test("Native fresh-install restore rejects non-portable remote Memory before checkpoint advancement", async () => {
  const harness = await createHarness({
    memoryObject: nonPortableRemoteMemory(),
  });

  await harness.sync.refresh();

  assert.deepEqual(
    harness.memory.search({
      ownerKind: "account",
      ownerId: SUBJECT,
      scopes: ["account"],
      includeRestricted: true,
    }),
    [],
  );
  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");

  harness.destroy();
});

test("Native fresh-install restore does not advance checkpoint when Memory durability fails", async () => {
  const harness = await createHarness({ memoryOptions: { failFlush: true } });

  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.events.includes("memory-flush"), true);
  assert.equal(harness.events.includes("checkpoint-flush"), false);

  harness.destroy();
});

test("Native account sync refuses remote Memory when coordination requires recovery", async () => {
  const incompatible = JSON.stringify({ $schema: "ordax.unknown/1", slots: {} });
  const harness = await createHarness({
    rootInitial: incompatible,
    settleFoundation: false,
  });

  assert.equal(harness.foundation.getSnapshot().state, "recovery-required");
  assert.notEqual(
    harness.foundation.memorySync,
    null,
    "recovery-required keeps the reconciler mounted so it can reject unsafe remote application",
  );

  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.deepEqual(
    harness.memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }),
    [],
  );

  harness.destroy();
});
