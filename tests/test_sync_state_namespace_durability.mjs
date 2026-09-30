import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";

test("sync-state namespace forwards durability flush and live root scope", async () => {
  let scope = "session";
  let payload = null;
  let flushes = 0;
  const root = {
    schema: SYNC_STATE_STORE_SCHEMA,
    get scope() {
      return scope;
    },
    load() {
      return payload;
    },
    save(value) {
      payload = value;
      return true;
    },
    async flush() {
      flushes += 1;
      scope = "device";
      return true;
    },
  };

  const registry = createSyncStateNamespaceRegistry(root);
  const memory = registry.open("memory", { partitionKey: "account-a" });

  assert.equal(registry.scope, "session");
  assert.equal(memory.scope, "session");
  memory.save("memory-state");
  await memory.flush();

  assert.equal(flushes, 1);
  assert.equal(registry.scope, "device");
  assert.equal(memory.scope, "device");
  assert.equal(memory.load(), "memory-state");
});

test("sync-state namespace flush remains compatible with synchronous roots", async () => {
  let payload = null;
  const root = {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
  };

  const memory = createSyncStateNamespaceRegistry(root).open("memory");
  memory.save("state");
  assert.equal(await memory.flush(), true);
  assert.equal(memory.load(), "state");
});
