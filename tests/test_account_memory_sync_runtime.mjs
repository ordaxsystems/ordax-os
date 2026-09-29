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
  assert.equal(result.sync.objectId, "memory-1");
  assert.equal(runtime.getSnapshot().pendingMutationCount, 1);
  const pending = runtime.pendingMutations()[0];
  assert.equal(pending.objectId, pending.payload.memory.id);
  assert.equal(pending.dataClass, MEMORY_SYNC_DATA_CLASS);
  assert.equal(pending.objectSchemaVersion, MEMORY_SYNC_OBJECT_SCHEMA_VERSION);
  assert.equal(pending.resolverVersion, MEMORY_SYNC_RESOLVER_VERSION);
  assert.equal(pending.payload.schema, MEMORY_SYNC_PAYLOAD_SCHEMA);
  assert.equal(pending.payload.memory.ownerKind, "account");
  assert.equal(pending.payload.memory.ownerId, SUBJECT);
  assert.equal("accessToken" in pending.payload.memory, false);
  assert.equal(JSON.stringify(pending).includes("must-not-cross-the-boundary"), false);

  const flushed = await runtime.flush(transport);
  assert.equal(flushed.accepted, 1);
  assert.equal(flushed.pendingMutationCount, 0);
  assert.equal(transport.mutations.length, 1);
});

test("Memory sync v1 fails closed for project, session, restricted and never-sync secret material", () => {
  const project = classifyMemoryForAccountSync(memoryItem({
    id: "project-memory",
    scope: "project",
    projectId: "project-1",
  }), { subjectId: SUBJECT });
  assert.equal(project.eligible, false);
  assert.equal(project.reason, "project-scope-local-only");

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

test("stable Memory object identity is the canonical memory id and survives edits", async () => {
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
  assert.equal(firstId, "memory-1");
  await runtime.flush(transport);

  const second = runtime.remember(memoryItem({ content: "segunda versão" }));
  assert.equal(second.sync.objectId, firstId);
  assert.equal(runtime.pendingMutations()[0].baseServerRevision, 4);
  await runtime.flush(transport);
  assert.equal(runtime.getSnapshot().pendingMutationCount, 0);
});

test("forget is represented by an explicit tombstone without Memory content", async () => {
  const { runtime, transport } = createRuntime();
  runtime.remember(memoryItem({ content: "conteúdo a esquecer" }));
  await runtime.flush(transport);
  const result = runtime.forget({ id: "memory-1", ownerKind: "account", ownerId: SUBJECT });
  assert.equal(result.removed, true);
  assert.equal(result.sync.status, "pending");

  const mutation = runtime.pendingMutations()[0];
  assert.equal(mutation.operation, "delete");
  assert.deepEqual(mutation.payload.memoryIdentity, {
    id: "memory-1",
    ownerKind: "account",
    ownerId: SUBJECT,
  });
  assert.equal(JSON.stringify(mutation).includes("conteúdo a esquecer"), false);

  const tombstone = createMemorySyncTombstone({
    id: "memory-1",
    ownerId: SUBJECT,
    serverRevision: 8,
  });
  assert.equal(tombstone.tombstone, true);
  assert.equal(tombstone.objectId, "memory-1");
  assert.equal(JSON.stringify(tombstone).includes("conteúdo a esquecer"), false);
});

test("remote tombstone applies forget through ordax.memory/1 and flushes local durability", async () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem());
  let flushCalls = 0;
  const memoryPort = {
    ...memory,
    async flush() {
      flushCalls += 1;
      return memory.flush();
    },
  };
  const { runtime } = createRuntime({ memory: memoryPort });
  const result = await runtime.applyRemoteObject(createMemorySyncTombstone({
    id: "memory-1",
    ownerId: SUBJECT,
    serverRevision: 2,
  }));
  assert.equal(result.status, "forgotten");
  assert.equal(flushCalls, 1);
  assert.equal(memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] }).length, 0);
});

test("transport failure preserves local Memory and the pending mutation for retry", async () => {
  const transport = createTransport({
    mutate() {
      throw new Error("network unavailable");
    },
  });
  const { memory, runtime } = createRuntime({ transport });
  runtime.remember(memoryItem());
  const before = runtime.pendingMutations()[0];
  const flushed = await runtime.flush(transport);
  assert.equal(flushed.accepted, 0);
  assert.equal(flushed.failures, 1);
  assert.equal(runtime.pendingMutations()[0].idempotencyKey, before.idempotencyKey);
  assert.equal(memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] })[0].id, "memory-1");
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
  const { runtime } = createRuntime({ transport });
  runtime.remember(memoryItem());
  const pendingBefore = runtime.pendingMutations()[0];
  const flushed = await runtime.flush(transport);
  assert.equal(flushed.accepted, 0);
  assert.equal(runtime.getSnapshot().conflictCount, 1);
  assert.equal(runtime.pendingMutations()[0].idempotencyKey, pendingBefore.idempotencyKey);
  assert.equal(runtime.pendingMutations()[0].baseServerRevision, 0);
  assert.equal(runtime.pendingConflicts()[0].serverRevision, 7);
});

test("divergent remote state for a pending Memory object is quarantined instead of applied", async () => {
  const { memory, runtime } = createRuntime();
  runtime.remember(memoryItem({ content: "local" }));
  const remote = createMemorySyncObject({
    item: memoryItem({ content: "remote" }),
    serverRevision: 3,
  });
  const result = await runtime.applyRemoteObject(remote);
  assert.equal(result.status, "conflict");
  assert.equal(runtime.getSnapshot().conflictCount, 1);
  assert.equal(memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] })[0].content, "local");
});

test("provider/cloud objects cannot redefine Memory ownership, stable identity, payload fields or authority", async () => {
  const { runtime } = createRuntime();
  const remote = createMemorySyncObject({ item: memoryItem(), serverRevision: 2 });

  await assert.rejects(
    () => runtime.applyRemoteObject({ ...remote, objectId: "different-memory-id" }),
    /identity does not match/,
  );
  await assert.rejects(
    () => runtime.applyRemoteObject({ ...remote, ownerKind: "device" }),
    /fields are incompatible|identity/,
  );
  await assert.rejects(
    () => runtime.applyRemoteObject({
      ...remote,
      payload: { ...remote.payload, grantsToolAuthority: true },
    }),
    /payload fields are incompatible/,
  );
  await assert.rejects(
    () => runtime.applyRemoteObject(createMemorySyncObject({
      item: memoryItem({ ownerId: "other-account" }),
      serverRevision: 3,
    })),
    /owner does not match|active account|owner-mismatch/,
  );
});

test("canonical account snapshot can feed Memory reconciliation without Memory owning a cursor or transport", async () => {
  const remoteMemory = createMemorySyncObject({ item: memoryItem({ id: "restored-memory" }), serverRevision: 9 });
  const transport = createTransport({
    snapshotObjects: [
      { objectId: "appearance/theme", dataClass: "appearance", serverRevision: 3 },
      remoteMemory,
    ],
  });
  const { memory, runtime } = createRuntime({ transport });

  const snapshot = await transport.snapshot({ limit: 200 });
  const restored = await runtime.applyRemoteBatch(snapshot.objects);
  assert.equal(restored.applied, 1);
  assert.equal(restored.ignored, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].id, "restored-memory");
  assert.equal(runtime.getSnapshot().reconciliationOwnership, "account-runtime");
  assert.equal(runtime.getSnapshot().ownsCursor, false);
  assert.equal(runtime.getSnapshot().ownsTransport, false);
  assert.equal("restore" in runtime, false);
  assert.equal("pull" in runtime, false);
});

test("Memory cloud-state boundary does not authorize training, telemetry or action authority", async () => {
  const cloudBoundary = JSON.parse(await readFile(new URL("../docs/contracts/cloud-memory-sync-boundary.json", import.meta.url), "utf8"));
  const syncModel = JSON.parse(await readFile(new URL("../docs/contracts/sync-model.json", import.meta.url), "utf8"));

  assert.equal(cloudBoundary.source_of_truth.sync_object_role, "transport-mirror-only");
  assert.equal(cloudBoundary.source_of_truth.independent_dual_write_allowed, false);
  assert.equal(cloudBoundary.identity.stable_object_id, "memory_id");
  assert.equal(cloudBoundary.eligible_scopes.account, "future-explicit-policy");
  assert.equal(cloudBoundary.eligible_scopes.space, "future-explicit-policy");
  assert.equal(cloudBoundary.eligible_scopes.project, false);
  assert.equal(cloudBoundary.public_mvp_enabled, false);
  assert.equal(cloudBoundary.implementation.public_rollout_enabled, false);
  assert.equal(syncModel.security.memory_sync_cloud_state_classification, "user-cloud-state");
  assert.equal(syncModel.security.memory_sync_implies_ai_training_authorization, false);
  assert.equal(syncModel.security.memory_sync_implies_telemetry_authorization, false);
  assert.equal(syncModel.security.memory_sync_implies_community_data_authorization, false);
  assert.equal(syncModel.security.memory_sync_grants_tool_authority, false);
  const memoryClass = syncModel.syncable_data_classes.find((entry) => entry.id === "memory");
  assert.equal(memoryClass.sync_object_role, "transport-mirror-only");
  assert.equal(memoryClass.current_client_integration, false);
  assert.equal(memoryClass.production_enabled, false);
  assert.equal(syncModel.conflicts.current_resolvers.memory.automatic_rebase, false);
});