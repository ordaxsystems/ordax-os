import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import {
  MEMORY_SYNC_DATA_CLASS,
  MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
  MEMORY_SYNC_PAYLOAD_SCHEMA,
  MEMORY_SYNC_RESOLVER_VERSION,
  classifyMemoryForAccountSync,
  createAccountMemorySyncRuntime,
  createMemorySyncObject,
  createMemorySyncTombstone,
} from "../system/services/sync/account-memory-runtime.mjs";

const SUBJECT = "account-subject-a";

function memoryItem(overrides = {}) {
  return {
    id: "memory-1",
    ownerKind: "account",
    ownerId: SUBJECT,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "Prefere respostas objetivas",
    provenance: "user-confirmed:test",
    sourceTimestamp: "2026-09-29T10:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function createTransport({ snapshotObjects = [], pullChanges = [], mutate = null } = {}) {
  const mutations = [];
  let revision = 0;
  return {
    schema: SYNC_TRANSPORT_SCHEMA,
    mutations,
    async snapshot() {
      return Object.freeze({ cursor: 10, objects: Object.freeze(snapshotObjects) });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({
        afterCursor,
        nextCursor: afterCursor + pullChanges.length,
        changes: Object.freeze(pullChanges),
      });
    },
    async applyMutation(mutation) {
      mutations.push(mutation);
      if (mutate) return mutate(mutation, mutations.length);
      revision = Math.max(revision + 1, mutation.baseServerRevision + 1);
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: revision,
        tombstone: mutation.operation === "delete",
        applied: true,
        conflict: false,
        changeCursor: revision,
      });
    },
  };
}

function createRuntime({ memory = createMemoryRuntime(), transport = createTransport(), authorizeSync = () => true } = {}) {
  let ordinal = 0;
  return {
    memory,
    transport,
    runtime: createAccountMemorySyncRuntime({
      memoryPort: memory,
      transport,
      subjectId: SUBJECT,
      authorizeSync,
      createIdempotencyKey(kind) {
        ordinal += 1;
        return `memory:${kind}:${ordinal}`;
      },
    }),
  };
}

test("device-owned Memory remains local and never enters account sync", () => {
  const { memory, transport, runtime } = createRuntime();
  const result = runtime.remember(memoryItem({
    id: "device-local",
    ownerKind: "device",
    ownerId: null,
    scope: "device",
  }));

  assert.equal(result.sync.status, "local-only");
  assert.equal(result.sync.reason, "device-owned");
  assert.equal(runtime.getSnapshot().pendingMutationCount, 0);
  assert.equal(transport.mutations.length, 0);
  assert.equal(memory.search({ ownerKind: "device", scopes: ["device"] })[0].id, "device-local");
});

test("eligible account-owned Memory becomes a versioned mutation over the existing sync transport", async () => {
  const { transport, runtime } = createRuntime();
  const result = runtime.remember(memoryItem({ accessToken: "must-not-cross-the-boundary" }));

  assert.equal(result.sync.status, "pending");
  assert.equal(runtime.getSnapshot().pendingMutationCount, 1);
  const pending = runtime.pendingMutations()[0];
  assert.equal(pending.dataClass, MEMORY_SYNC_DATA_CLASS);
  assert.equal(pending.objectSchemaVersion, MEMORY_SYNC_OBJECT_SCHEMA_VERSION);
  assert.equal(pending.resolverVersion, MEMORY_SYNC_RESOLVER_VERSION);
  assert.equal(pending.payload.schema, MEMORY_SYNC_PAYLOAD_SCHEMA);
  assert.equal(pending.payload.memory.ownerKind, "account");
  assert.equal(pending.payload.memory.ownerId, SUBJECT);
  assert.equal("accessToken" in pending.payload.memory, false);
  assert.equal(JSON.stringify(pending).includes("must-not-cross-the-boundary"), false);

  const flushed = await runtime.flush();
  assert.equal(flushed.accepted, 1);
  assert.equal(flushed.pendingMutationCount, 0);
  assert.equal(transport.mutations.length, 1);
});

test("Memory sync v1 fails closed for session, restricted and never-sync secret material", () => {
  const session = classifyMemoryForAccountSync(memoryItem({ id: "session", scope: "session" }), { subjectId: SUBJECT });
  assert.equal(session.eligible, false);
  assert.equal(session.reason, "session-scope-local-only");

  const restricted = classifyMemoryForAccountSync(memoryItem({ id: "restricted", sensitivity: "restricted" }), { subjectId: SUBJECT });
  assert.equal(restricted.eligible, false);
  assert.equal(restricted.reason, "restricted-not-syncable");

  const bearer = classifyMemoryForAccountSync(memoryItem({
    id: "bearer-secret",
    content: "Authorization: Bearer secret-token-value-123456",
  }), { subjectId: SUBJECT });
  assert.equal(bearer.eligible, false);
  assert.equal(bearer.reason, "never-sync-secret-material");

  assert.throws(
    () => classifyMemoryForAccountSync(memoryItem({
      id: "known-secret-shape",
      content: "sk-1234567890abcdefghijklmnop",
    }), { subjectId: SUBJECT }),
    /Secrets are not valid OrdaX memory items/,
  );
});

test("stable Memory object identity survives edits and accepted server revisions become the next base", async () => {
  const transport = createTransport({
    mutate(mutation, attempt) {
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: attempt === 1 ? 4 : 5,
        tombstone: false,
        applied: true,
        conflict: false,
        changeCursor: attempt,
      });
    },
  });
  const { runtime } = createRuntime({ transport });
  const first = runtime.remember(memoryItem({ content: "primeira versão" }));
  const firstId = first.sync.objectId;
  await runtime.flush();

  const second = runtime.remember(memoryItem({
    content: "segunda versão",
    sourceTimestamp: "2026-09-29T10:05:00Z",
  }));
  assert.equal(second.sync.objectId, firstId);
  assert.equal(runtime.pendingMutations()[0].baseServerRevision, 4);
  await runtime.flush();
  assert.equal(runtime.getSnapshot().pendingMutationCount, 0);
});

test("forget is represented by an explicit tombstone without Memory content", () => {
  const { runtime } = createRuntime();
  runtime.remember(memoryItem());
  const forgotten = runtime.forget({ id: "memory-1", ownerKind: "account", ownerId: SUBJECT });
  assert.equal(forgotten.removed, true);
  assert.equal(forgotten.sync.status, "pending");
  const mutation = runtime.pendingMutations()[0];
  assert.equal(mutation.operation, "delete");
  assert.equal(mutation.payload.schema, MEMORY_SYNC_PAYLOAD_SCHEMA);
  assert.deepEqual(Object.keys(mutation.payload.memoryIdentity).sort(), ["id", "ownerId", "ownerKind"]);
  assert.equal(JSON.stringify(mutation).includes("Prefere respostas objetivas"), false);
});

test("remote tombstone applies forget through ordax.memory/1 and flushes local durability", async () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem());
  const { runtime } = createRuntime({ memory });
  const tombstone = createMemorySyncTombstone({ id: "memory-1", ownerId: SUBJECT, serverRevision: 3 });

  const result = await runtime.applyRemoteObject(tombstone);
  assert.equal(result.status, "forgotten");
  assert.deepEqual(memory.search({ ownerId: SUBJECT, scopes: ["account"] }), []);
});

test("transport failure preserves local Memory and the pending mutation for retry", async () => {
  const transport = createTransport({
    mutate() {
      throw new Error("offline");
    },
  });
  const { memory, runtime } = createRuntime({ transport });
  runtime.remember(memoryItem({ content: "offline local state" }));

  const flushed = await runtime.flush();
  assert.equal(flushed.failures, 1);
  assert.equal(flushed.pendingMutationCount, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "offline local state");
});

test("server conflict remains pending and is never silently rebased or overwritten", async () => {
  const transport = createTransport({
    mutate(mutation) {
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: 7,
        tombstone: false,
        applied: false,
        conflict: true,
        changeCursor: null,
      });
    },
  });
  const { memory, runtime } = createRuntime({ transport });
  runtime.remember(memoryItem({ content: "local intent must survive" }));

  await runtime.flush();
  assert.equal(runtime.getSnapshot().pendingMutationCount, 1);
  assert.equal(runtime.getSnapshot().conflictCount, 1);
  assert.equal(runtime.pendingConflicts()[0].reason, "server-conflict");
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "local intent must survive");

  await runtime.flush();
  assert.equal(transport.mutations.length, 1, "conflicted Memory must not be retried via implicit rebase");
});

test("divergent remote state for a pending Memory object is quarantined instead of applied", async () => {
  const { memory, runtime } = createRuntime();
  const local = runtime.remember(memoryItem({ content: "local pending" }));
  const remote = createMemorySyncObject({
    item: memoryItem({ content: "remote concurrent", sourceTimestamp: "2026-09-29T10:06:00Z" }),
    serverRevision: 2,
  });
  assert.equal(remote.objectId, local.sync.objectId);

  const result = await runtime.applyRemoteObject(remote);
  assert.equal(result.status, "conflict");
  assert.equal(runtime.pendingConflicts()[0].reason, "concurrent-remote-update");
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "local pending");
});

test("provider/cloud objects cannot redefine Memory ownership, payload fields or authority", async () => {
  const { runtime } = createRuntime();
  const valid = createMemorySyncObject({ item: memoryItem(), serverRevision: 1 });

  await assert.rejects(
    () => runtime.applyRemoteObject({
      ...valid,
      payload: { ...valid.payload, providerAuthorization: { tool: "shell" } },
    }),
    /payload fields are incompatible/,
  );
  await assert.rejects(
    () => runtime.applyRemoteObject({
      ...valid,
      payload: {
        schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
        memory: { ...valid.payload.memory, ownerId: "different-account" },
      },
    }),
    /not eligible|identity|owner/i,
  );
});

test("fresh-install Memory restore consumes the existing account snapshot transport without touching other data classes", async () => {
  const remoteMemory = createMemorySyncObject({ item: memoryItem({ id: "restored-memory" }), serverRevision: 9 });
  const transport = createTransport({
    snapshotObjects: [
      { objectId: "appearance/theme", dataClass: "appearance", serverRevision: 3 },
      remoteMemory,
    ],
  });
  const { memory, runtime } = createRuntime({ transport });

  const restored = await runtime.restore();
  assert.equal(restored.cursor, 10);
  assert.equal(restored.applied, 1);
  assert.equal(restored.ignored, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].id, "restored-memory");
});

test("Memory cloud-state contract explicitly does not authorize training, telemetry, community data or tools", async () => {
  const memoryContract = JSON.parse(await readFile(new URL("../docs/contracts/memory.json", import.meta.url), "utf8"));
  const syncModel = JSON.parse(await readFile(new URL("../docs/contracts/sync-model.json", import.meta.url), "utf8"));

  assert.equal(memoryContract.sync.cloud_state_classification, "user-cloud-state");
  assert.equal(memoryContract.sync.sync_implies_ai_training_authorization, false);
  assert.equal(memoryContract.sync.sync_implies_telemetry_authorization, false);
  assert.equal(memoryContract.sync.sync_implies_community_data_authorization, false);
  assert.equal(memoryContract.sync.sync_grants_tool_authority, false);
  const memoryClass = syncModel.syncable_data_classes.find((entry) => entry.id === "memory");
  assert.equal(memoryClass.current_client_integration, false);
  assert.equal(memoryClass.production_enabled, false);
  assert.equal(syncModel.conflicts.current_resolvers.memory.automatic_rebase, false);
});
