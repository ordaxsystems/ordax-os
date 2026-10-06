import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_STORE_SCHEMA } from "../system/contracts/project-store.mjs";
import { createProjectNativeStateMigration } from "../system/services/files/native-project-state-migration.mjs";

function emptyState() {
  return { nextOrdinal: 1, projects: [] };
}

function populatedState(name = "Finance App") {
  return {
    nextOrdinal: 2,
    projects: [{
      id: "project-1",
      name,
      path: "/Documentos/finance-app",
      createdAt: 1000,
      lastOpenedAt: 2000,
      lastFilePath: null,
    }],
  };
}

function legacyStore(stateValue) {
  return {
    schema: PROJECT_STORE_SCHEMA,
    scope: "device",
    load() { return stateValue; },
    save() { throw new Error("migration must never mutate legacy Project state"); },
  };
}

function nativeTransport(initialRecord = null, { conflictOnWrite = false } = {}) {
  let record = initialRecord;
  return {
    async read() { return record; },
    async compareAndSwap(expectedRevision, state) {
      if (expectedRevision !== 0) throw new Error("test transport only permits first migration write");
      if (conflictOnWrite) {
        if (record === null) record = { revision: 1, state };
        return { accepted: false, revision: null };
      }
      if (record !== null) return { accepted: false, revision: null };
      record = { revision: 1, state };
      return { accepted: true, revision: 1 };
    },
  };
}

test("empty legacy Project catalog does not manufacture a Native record", async () => {
  const migration = createProjectNativeStateMigration({
    legacyStore: legacyStore(emptyState()),
    nativeTransport: nativeTransport(),
  });
  assert.deepEqual(await migration.inspect(), {
    status: "empty",
    nativeRevision: 0,
    legacyEmpty: true,
    nativePresent: false,
  });
  assert.deepEqual(await migration.migrate(), { status: "empty", revision: 0 });
});

test("legacy-only Project catalog migrates once and verifies exact durable readback", async () => {
  const transport = nativeTransport();
  const migration = createProjectNativeStateMigration({
    legacyStore: legacyStore(populatedState()),
    nativeTransport: transport,
  });
  assert.equal((await migration.inspect()).status, "legacy-only");
  assert.deepEqual(await migration.migrate(), { status: "migrated", revision: 1 });
  assert.equal((await migration.inspect()).status, "mirrored-identical");
});

test("divergent Project catalogs block automatic migration instead of choosing a winner", async () => {
  const migration = createProjectNativeStateMigration({
    legacyStore: legacyStore(populatedState("Legacy")),
    nativeTransport: nativeTransport({ revision: 2, state: populatedState("Native") }),
  });
  assert.equal((await migration.inspect()).status, "conflict");
  await assert.rejects(migration.migrate(), /diverged/);
});

test("CAS race is accepted only when readback converges to the exact legacy state", async () => {
  const legacy = populatedState();
  const migration = createProjectNativeStateMigration({
    legacyStore: legacyStore(legacy),
    nativeTransport: nativeTransport(null, { conflictOnWrite: true }),
  });
  assert.deepEqual(await migration.migrate(), { status: "race-converged", revision: 1 });
});

test("existing Native state wins over empty legacy without reverse-copying into localStorage", async () => {
  const migration = createProjectNativeStateMigration({
    legacyStore: legacyStore(emptyState()),
    nativeTransport: nativeTransport({ revision: 4, state: populatedState() }),
  });
  assert.deepEqual(await migration.inspect(), {
    status: "native-only",
    nativeRevision: 4,
    legacyEmpty: true,
    nativePresent: true,
  });
  assert.deepEqual(await migration.migrate(), { status: "already-native", revision: 4 });
});
