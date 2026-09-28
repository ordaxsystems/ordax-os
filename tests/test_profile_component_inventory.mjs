import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA,
  createEmptyProfileComponentInventory,
  validateProfileComponentInventory,
} from "../system/contracts/profile-component-inventory.mjs";
import { createSessionProfileComponentInventory } from "../system/services/profile-packs/inventory.mjs";

test("empty Profile component inventory is session-scoped and bounded", () => {
  const empty = createEmptyProfileComponentInventory();
  assert.equal(empty.schema, "ordax.profile-component-inventory/1");
  assert.equal(empty.revision, 0);
  assert.equal(empty.persistence, "session");
  assert.deepEqual(empty.entries, []);
  assert.deepEqual(validateProfileComponentInventory(empty), empty);
});

test("inventory requires exact content and receipt hashes", () => {
  const value = validateProfileComponentInventory({
    schema: "ordax.profile-component-inventory/1",
    revision: 2,
    persistence: "device",
    entries: [{
      id: "knowledge.example",
      kind: "knowledge-pack",
      version: "1.2.3",
      sha256: "a".repeat(64),
      installedAt: 1234,
      receiptSha256: "b".repeat(64),
    }],
  });
  assert.equal(value.entries[0].version, "1.2.3");
  assert.equal(value.entries[0].sha256, "a".repeat(64));
  assert.equal(value.entries[0].receiptSha256, "b".repeat(64));

  const duplicate = {
    ...value,
    entries: [value.entries[0], value.entries[0]],
  };
  assert.throws(
    () => validateProfileComponentInventory(duplicate),
    /duplicate content identity/,
  );
});

test("session inventory port is read-only and does not claim device persistence", async () => {
  const inventory = createSessionProfileComponentInventory();
  assert.equal(inventory.schema, PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA);
  assert.equal(inventory.getSnapshot().persistence, "session");
  assert.deepEqual(inventory.getSnapshot().entries, []);
  assert.deepEqual(await inventory.refresh(), inventory.getSnapshot());
  assert.equal(typeof inventory.install, "undefined");
  assert.equal(typeof inventory.record, "undefined");
});
