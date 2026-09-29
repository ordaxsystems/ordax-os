import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_STATE_STORE_SCHEMA,
  MAX_SYNC_STATE_PAYLOAD_BYTES,
  validateSyncStatePayload,
} from "../system/contracts/sync-state-store.mjs";
import {
  SYNC_STATE_CONTAINER_SCHEMA,
  createSyncStateNamespaceRegistry,
} from "../system/services/sync/state-store-registry.mjs";

function rootStore(initial = null) {
  let value = initial;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load() {
      return value;
    },
    save(payload) {
      value = validateSyncStatePayload(payload);
      return true;
    },
    read() {
      return value;
    },
  };
}

test("Appearance and Memory coordination coexist in one canonical sync-state store", () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const appearance = registry.open("appearance");
  const memory = registry.open("memory");

  appearance.save('{"$schema":"ordax.preference-sync-state/1","serverRevision":4,"mutations":[]}');
  memory.save('{"$schema":"ordax.memory-sync-state/1","subjectId":"user-1","revisions":[],"pending":[],"conflicts":[]}');

  assert.match(appearance.load(), /ordax\.preference-sync-state\/1/);
  assert.match(memory.load(), /ordax\.memory-sync-state\/1/);
  const container = JSON.parse(root.read());
  assert.equal(container.$schema, SYNC_STATE_CONTAINER_SCHEMA);
  assert.deepEqual(Object.keys(container.slots), ["appearance", "memory"]);
});

test("first Memory write migrates the pre-container Appearance payload without overwriting it", () => {
  const legacyAppearance = '{"$schema":"ordax.preference-sync-state/1","serverRevision":2,"mutations":[]}';
  const root = rootStore(legacyAppearance);
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const appearance = registry.open("appearance");
  const memory = registry.open("memory");

  assert.equal(appearance.load(), legacyAppearance);
  assert.equal(memory.load(), null);
  memory.save('{"$schema":"ordax.memory-sync-state/1","subjectId":"user-1","revisions":[],"pending":[],"conflicts":[]}');

  assert.equal(appearance.load(), legacyAppearance);
  const container = JSON.parse(root.read());
  assert.equal(container.slots.appearance, legacyAppearance);
  assert.match(container.slots.memory, /ordax\.memory-sync-state\/1/);
});

test("one namespace update preserves every other namespace", () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const appearance = registry.open("appearance");
  const memory = registry.open("memory");

  appearance.save("appearance-v1");
  memory.save("memory-v1");
  appearance.save("appearance-v2");

  assert.equal(appearance.load(), "appearance-v2");
  assert.equal(memory.load(), "memory-v1");
});

test("Memory coordination can be partitioned by account without one account overwriting another", () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const accountA = registry.open("memory", { partitionKey: "account-subject-a" });
  const accountB = registry.open("memory", { partitionKey: "account-subject-b" });

  accountA.save('{"$schema":"ordax.memory-sync-state/1","subjectId":"account-subject-a","revisions":[],"pending":[],"conflicts":[]}');
  accountB.save('{"$schema":"ordax.memory-sync-state/1","subjectId":"account-subject-b","revisions":[],"pending":[],"conflicts":[]}');

  assert.match(accountA.load(), /account-subject-a/);
  assert.match(accountB.load(), /account-subject-b/);
  const slots = Object.keys(JSON.parse(root.read()).slots);
  assert.equal(slots.length, 2);
  assert.notEqual(slots[0], slots[1]);
  assert.equal(slots.some((key) => key.includes("account-subject-a")), false, "raw subject id must not be used as a slot key");
});

test("incompatible root container fails closed instead of being claimed by Memory", () => {
  const root = rootStore(JSON.stringify({ $schema: "unknown.sync-state/9", slots: {} }));
  const registry = createSyncStateNamespaceRegistry(root);
  const memory = registry.open("memory");

  assert.throws(() => memory.load(), /schema is incompatible/);
  assert.throws(() => memory.save("memory-v1"), /schema is incompatible/);
  assert.match(root.read(), /unknown\.sync-state\/9/);
});

test("combined namespaces remain bounded by the existing 64 KiB root-store contract", () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const appearance = registry.open("appearance");
  const memory = registry.open("memory");
  appearance.save("a".repeat(Math.floor(MAX_SYNC_STATE_PAYLOAD_BYTES / 2)));
  const before = root.read();

  assert.throws(
    () => memory.save("m".repeat(Math.floor(MAX_SYNC_STATE_PAYLOAD_BYTES / 2))),
    /maximum size/,
  );
  assert.equal(root.read(), before, "overflow must not replace the last valid root payload");
});

test("namespace and partition identities are bounded and each logical slot is stable", () => {
  const registry = createSyncStateNamespaceRegistry(rootStore());
  const first = registry.open("memory", { partitionKey: "account-subject-a" });
  const second = registry.open("memory", { partitionKey: "account-subject-a" });
  assert.equal(first, second);
  assert.throws(() => registry.open("Memory/unsafe"), /namespace is invalid/);
  assert.throws(() => registry.open("memory", { partitionKey: "" }), /partition key is invalid/);
  assert.throws(() => registry.open("memory", { partitionKey: "x".repeat(201) }), /partition key is invalid/);
});
