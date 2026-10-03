import assert from "node:assert/strict";
import test from "node:test";

import { PERSONAL_ORDAX_STORE_SCHEMA } from "../system/contracts/personal-ordax-store.mjs";
import { createPersonalOrdaxNativeStateMigration } from "../system/services/personal-ordax/native-state-migration.mjs";

function owner() {
  return { ownerKind: "account", ownerId: "user-1" };
}

function state(nextOrdinal = 1) {
  return {
    schema: "ordax.personal-work-store-state/1",
    ownerKind: "account",
    ownerId: "user-1",
    nextOrdinal,
    workItems: [],
    activities: [],
    results: [],
    approvals: [],
    decisions: [],
    attempts: [],
  };
}

function legacyStore(value) {
  return {
    schema: PERSONAL_ORDAX_STORE_SCHEMA,
    scope: "device",
    load() { return value === null ? null : structuredClone(value); },
    save() { throw new Error("migration must never write or delete the legacy store"); },
  };
}

function transport(initial = null, { conflictMode = "none" } = {}) {
  let record = initial === null ? null : { revision: initial.revision, state: structuredClone(initial.state) };
  let casCalls = 0;
  return {
    async read() {
      return record === null ? null : { revision: record.revision, state: structuredClone(record.state) };
    },
    async compareAndSwap(_owner, expectedRevision, nextState) {
      casCalls += 1;
      if (expectedRevision !== 0) throw new Error("test transport only supports create CAS");
      if (record !== null) return { accepted: false, revision: record.revision };
      if (conflictMode === "different-writer") {
        record = { revision: 1, state: state(2) };
        return { accepted: false, revision: 0 };
      }
      if (conflictMode === "same-writer") {
        record = { revision: 1, state: structuredClone(nextState) };
        return { accepted: false, revision: 0 };
      }
      record = { revision: 1, state: structuredClone(nextState) };
      return { accepted: true, revision: 1 };
    },
    get casCalls() { return casCalls; },
  };
}

test("legacy-only state migrates with create-CAS and is verified by readback", async () => {
  const native = transport();
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(state()),
    nativeTransport: native,
  });
  assert.deepEqual(await migration.inspect(owner()), {
    status: "legacy-only",
    nativeRevision: 0,
    legacyPresent: true,
    nativePresent: false,
  });
  assert.deepEqual(await migration.migrate(owner()), { status: "migrated", revision: 1 });
  assert.equal(native.casCalls, 1);
  assert.deepEqual(await migration.inspect(owner()), {
    status: "mirrored-identical",
    nativeRevision: 1,
    legacyPresent: true,
    nativePresent: true,
  });
});

test("existing identical Native state is authoritative and never rewritten", async () => {
  const native = transport({ revision: 4, state: state() });
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(state()),
    nativeTransport: native,
  });
  assert.deepEqual(await migration.migrate(owner()), { status: "already-native", revision: 4 });
  assert.equal(native.casCalls, 0);
});

test("divergent legacy and Native states fail closed without overwrite", async () => {
  const native = transport({ revision: 3, state: state(2) });
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(state()),
    nativeTransport: native,
  });
  assert.deepEqual(await migration.inspect(owner()), {
    status: "conflict",
    nativeRevision: 3,
    legacyPresent: true,
    nativePresent: true,
  });
  await assert.rejects(migration.migrate(owner()), /diverged/);
  assert.equal(native.casCalls, 0);
});

test("concurrent writer with the same state converges safely", async () => {
  const native = transport(null, { conflictMode: "same-writer" });
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(state()),
    nativeTransport: native,
  });
  assert.deepEqual(await migration.migrate(owner()), { status: "race-converged", revision: 1 });
  assert.equal(native.casCalls, 1);
});

test("concurrent writer with different state blocks migration", async () => {
  const native = transport(null, { conflictMode: "different-writer" });
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(state()),
    nativeTransport: native,
  });
  await assert.rejects(migration.migrate(owner()), /verify the exact legacy state/);
  assert.equal(native.casCalls, 1);
});

test("empty legacy and Native state remains empty without side effects", async () => {
  const native = transport();
  const migration = createPersonalOrdaxNativeStateMigration({
    legacyStore: legacyStore(null),
    nativeTransport: native,
  });
  assert.deepEqual(await migration.migrate(owner()), { status: "empty", revision: 0 });
  assert.equal(native.casCalls, 0);
});
