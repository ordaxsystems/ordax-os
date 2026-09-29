import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import {
  ACCOUNT_MEMORY_CONTINUITY_SCHEMA,
  createAccountMemoryContinuityPort,
} from "../system/services/sync/account-memory-continuity.mjs";

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable account memory",
    provenance: "user-confirmed:continuity-test",
    sourceTimestamp: "2026-09-29T22:45:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function stagingPort() {
  const upserts = [];
  const forgets = [];
  return {
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    stageUpsert(value) {
      upserts.push(value);
      return { status: "pending", reason: "queued", objectId: value.id };
    },
    stageForget(value) {
      forgets.push(value);
      return { status: "pending", reason: "queued", objectId: value.id };
    },
    upserts,
    forgets,
  };
}

test("continuity port commits local Memory before staging account sync", () => {
  const local = createMemoryRuntime();
  const sync = stagingPort();
  const continuity = createAccountMemoryContinuityPort({ memoryPort: local, memorySync: sync });

  assert.equal(continuity.continuitySchema, ACCOUNT_MEMORY_CONTINUITY_SCHEMA);
  const remembered = continuity.remember(item());

  assert.equal(remembered.id, "memory-a");
  assert.equal(sync.upserts.length, 1);
  assert.equal(sync.upserts[0], remembered);
  assert.equal(local.search({ ownerKind: "account", ownerId: "account-a", scopes: ["account"] })[0], remembered);
});

test("continuity port preserves the completed local write when sync staging fails", () => {
  const local = createMemoryRuntime();
  const continuity = createAccountMemoryContinuityPort({
    memoryPort: local,
    memorySync: {
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      stageUpsert() {
        throw new Error("coordination unavailable");
      },
      stageForget() {
        throw new Error("coordination unavailable");
      },
    },
  });

  assert.throws(() => continuity.remember(item()), /coordination unavailable/);
  assert.equal(
    local.search({ ownerKind: "account", ownerId: "account-a", scopes: ["account"] })[0].id,
    "memory-a",
    "sync coordination must never roll back an already accepted local Memory write",
  );
});

test("forget stages a tombstone only after an existing local item was removed", () => {
  const local = createMemoryRuntime();
  const sync = stagingPort();
  const continuity = createAccountMemoryContinuityPort({ memoryPort: local, memorySync: sync });
  const request = { id: "memory-a", ownerKind: "account", ownerId: "account-a" };

  assert.equal(continuity.forget(request), false);
  assert.equal(sync.forgets.length, 0);

  continuity.remember(item());
  assert.equal(continuity.forget(request), true);
  assert.equal(sync.forgets.length, 1);
  assert.deepEqual(sync.forgets[0], request);
});

test("remote/raw Memory application does not loop back into local mutation staging", () => {
  const local = createMemoryRuntime();
  const sync = stagingPort();
  createAccountMemoryContinuityPort({ memoryPort: local, memorySync: sync });

  local.remember(item({ id: "remote-a", content: "restored from remote" }));
  assert.equal(sync.upserts.length, 0);
});

test("continuity flush owns only local persistence and never invokes cloud transport", async () => {
  let localFlushes = 0;
  const base = createMemoryRuntime();
  const local = {
    ...base,
    async flush() {
      localFlushes += 1;
      return true;
    },
  };
  const sync = stagingPort();
  const continuity = createAccountMemoryContinuityPort({ memoryPort: local, memorySync: sync });

  assert.equal(await continuity.flush(), true);
  assert.equal(localFlushes, 1);
  assert.equal(typeof sync.flush, "undefined", "continuity port must not own cloud transport flushing");
});
