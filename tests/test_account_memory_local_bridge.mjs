import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemoryLocalBridge } from "../system/services/sync/account-memory-local-bridge.mjs";

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    content: "prefers compact panels",
    provenance: "user-confirmed:test",
    sensitivity: "private",
    sourceTimestamp: "2026-09-29T23:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function syncRuntime({ throwOnUpsert = false, throwOnForget = false } = {}) {
  const staged = [];
  return {
    staged,
    runtime: Object.freeze({
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      getSnapshot() {
        return Object.freeze({ subjectId: "account-a", pendingMutationCount: staged.length });
      },
      stageUpsert(value) {
        if (throwOnUpsert) throw new Error("coordination unavailable");
        staged.push({ kind: "upsert", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
      stageForget(value) {
        if (throwOnForget) throw new Error("coordination unavailable");
        staged.push({ kind: "delete", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
    }),
  };
}

function find(memory, id = "memory-a") {
  return memory.search({
    ownerKind: "account",
    ownerId: "account-a",
    scopes: ["account"],
    includeRestricted: true,
    limit: 20,
    offset: 0,
  }).find((entry) => entry.id === id) ?? null;
}

test("remember commits local Memory before staging account sync", () => {
  const memory = createMemoryRuntime();
  const sync = syncRuntime();
  const bridge = createAccountMemoryLocalBridge({ memoryPort: memory, memorySync: sync.runtime });

  const remembered = bridge.port.remember(item());

  assert.equal(find(memory)?.content, remembered.content);
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].kind, "upsert");
  assert.equal(sync.staged[0].value.id, "memory-a");
  assert.equal(bridge.getSnapshot().lastStageResult.result.status, "pending");
});

test("stage results expose exact trusted context without changing Memory port semantics", () => {
  const memory = createMemoryRuntime();
  const sync = syncRuntime();
  const reports = [];
  const bridge = createAccountMemoryLocalBridge({
    memoryPort: memory,
    memorySync: sync.runtime,
    onStageResult(result, context) {
      reports.push({ result, context });
    },
  });

  bridge.port.remember(item());

  assert.equal(reports.length, 1);
  assert.equal(reports[0].result.status, "pending");
  assert.equal(reports[0].context.kind, "upsert");
  assert.equal(reports[0].context.value.id, "memory-a");
});

test("a staging failure never rolls back an already committed local Memory item", () => {
  const memory = createMemoryRuntime();
  const sync = syncRuntime({ throwOnUpsert: true });
  const errors = [];
  const bridge = createAccountMemoryLocalBridge({
    memoryPort: memory,
    memorySync: sync.runtime,
    onStageError(error, context) {
      errors.push({ error, context });
    },
  });

  const remembered = bridge.port.remember(item());

  assert.equal(remembered.id, "memory-a");
  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.kind, "upsert");
  assert.match(errors[0].error.message, /coordination unavailable/);
  assert.equal(bridge.getSnapshot().lastStageResult.result, null);
});

test("portable to restricted transition stages identity-only cloud cleanup instead of an upsert", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const sync = syncRuntime();
  const reports = [];
  const bridge = createAccountMemoryLocalBridge({
    memoryPort: memory,
    memorySync: sync.runtime,
    onStageResult(result, context) {
      reports.push({ result, context });
    },
  });

  const restricted = bridge.port.remember(item({
    sensitivity: "restricted",
    content: "now private to this device context",
    sourceTimestamp: "2026-09-29T23:01:00Z",
  }));

  assert.equal(restricted.sensitivity, "restricted");
  assert.equal(find(memory)?.sensitivity, "restricted");
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].kind, "delete");
  assert.deepEqual(sync.staged[0].value, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
  assert.equal(reports[0].context.transition, "portable-to-local-only");
  assert.equal(reports[0].context.localItem.sensitivity, "restricted");
});

test("already local-only Memory does not manufacture a cloud tombstone on another local-only edit", () => {
  const memory = createMemoryRuntime();
  memory.remember(item({ sensitivity: "restricted" }));
  const sync = syncRuntime();
  const bridge = createAccountMemoryLocalBridge({ memoryPort: memory, memorySync: sync.runtime });

  bridge.port.remember(item({
    sensitivity: "restricted",
    content: "still local only",
    sourceTimestamp: "2026-09-29T23:02:00Z",
  }));

  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].kind, "upsert");
  assert.equal(sync.staged.some((entry) => entry.kind === "delete"), false);
});

test("forget commits locally and stages an identity-only delete request", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const sync = syncRuntime();
  const bridge = createAccountMemoryLocalBridge({ memoryPort: memory, memorySync: sync.runtime });

  const request = { id: "memory-a", ownerKind: "account", ownerId: "account-a" };
  assert.equal(bridge.port.forget(request), true);

  assert.equal(find(memory), null);
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].kind, "delete");
  assert.deepEqual(sync.staged[0].value, request);
});

test("forget of a missing item does not manufacture a cloud tombstone", () => {
  const memory = createMemoryRuntime();
  const sync = syncRuntime();
  const bridge = createAccountMemoryLocalBridge({ memoryPort: memory, memorySync: sync.runtime });

  assert.equal(bridge.port.forget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" }), false);
  assert.equal(sync.staged.length, 0);
});

test("delete staging failure cannot resurrect locally forgotten Memory", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const sync = syncRuntime({ throwOnForget: true });
  const errors = [];
  const bridge = createAccountMemoryLocalBridge({
    memoryPort: memory,
    memorySync: sync.runtime,
    onStageError(error) {
      errors.push(error);
    },
  });

  assert.equal(bridge.port.forget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" }), true);
  assert.equal(find(memory), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /coordination unavailable/);
});
