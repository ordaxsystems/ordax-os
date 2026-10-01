import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_ORDAX_STORE_STATE_SCHEMA,
  createEmptyPersonalOrdaxStoreState,
} from "../system/contracts/personal-ordax-store.mjs";
import { createNativePersonalOrdaxStore } from "../system/adapters/native/personal-ordax.mjs";

const DEVICE = Object.freeze({ ownerKind: "device", ownerId: null });
const USER_A = Object.freeze({ ownerKind: "account", ownerId: "user-a" });
const USER_B = Object.freeze({ ownerKind: "account", ownerId: "user-b" });

function localStorageWindow() {
  const values = new Map();
  let rejectWrites = false;
  return {
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        if (rejectWrites) throw new Error("quota");
        values.set(key, String(value));
      },
    },
    values,
    rejectWrites(value = true) {
      rejectWrites = value;
    },
  };
}

function state(owner, nextOrdinal = 1) {
  return {
    ...createEmptyPersonalOrdaxStoreState(owner),
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal,
  };
}

function keyFor(owner) {
  const ownerKey = owner.ownerKind === "device" ? "device" : `account:${owner.ownerId}`;
  return `ordax.native.personal-ordax.v1.${encodeURIComponent(ownerKey)}`;
}

test("Native Personal OrdaX store persists independent owner partitions", () => {
  const windowRef = localStorageWindow();
  const first = createNativePersonalOrdaxStore(windowRef);
  assert.equal(first.scope, "device");

  assert.equal(first.save(DEVICE, state(DEVICE)), true);
  assert.equal(first.save(USER_A, state(USER_A)), true);
  assert.equal(first.save(USER_B, state(USER_B)), true);

  const second = createNativePersonalOrdaxStore(windowRef);
  assert.equal(second.load(DEVICE).ownerKind, "device");
  assert.equal(second.load(USER_A).ownerId, "user-a");
  assert.equal(second.load(USER_B).ownerId, "user-b");
  assert.equal(windowRef.values.size, 3);
});

test("Native Personal OrdaX store rejects cross-owner state before persistence", () => {
  const windowRef = localStorageWindow();
  const store = createNativePersonalOrdaxStore(windowRef);

  assert.throws(
    () => store.save(USER_A, state(USER_B)),
    /different owner/,
  );
  assert.equal(windowRef.values.size, 0);
});

test("corrupt owner partition is preserved and blocked without poisoning other owners", () => {
  const windowRef = localStorageWindow();
  const corruptKey = keyFor(USER_A);
  const originalBytes = "{not-json";
  windowRef.values.set(corruptKey, originalBytes);

  const store = createNativePersonalOrdaxStore(windowRef);
  assert.throws(() => store.load(USER_A), /not valid JSON/);
  assert.equal(windowRef.values.get(corruptKey), originalBytes);

  assert.throws(
    () => store.save(USER_A, state(USER_A)),
    /requires recovery/,
  );
  assert.equal(windowRef.values.get(corruptKey), originalBytes);

  assert.equal(store.save(USER_B, state(USER_B)), true);
  assert.equal(store.load(USER_B).ownerId, "user-b");
  assert.equal(windowRef.values.get(corruptKey), originalBytes);
});

test("schema-valid record with wrong owner is also recovery-blocked without overwrite", () => {
  const windowRef = localStorageWindow();
  const key = keyFor(USER_A);
  const wrongState = state(USER_B);
  const original = JSON.stringify({
    schema: "ordax.native.personal-ordax-record/1",
    state: wrongState,
  });
  windowRef.values.set(key, original);

  const store = createNativePersonalOrdaxStore(windowRef);
  assert.throws(() => store.load(USER_A), /different owner/);
  assert.throws(() => store.save(USER_A, state(USER_A)), /requires recovery/);
  assert.equal(windowRef.values.get(key), original);
});

test("write failure reports session degradation without replacing last durable record", () => {
  const windowRef = localStorageWindow();
  const store = createNativePersonalOrdaxStore(windowRef);
  assert.equal(store.save(DEVICE, state(DEVICE)), true);
  const before = windowRef.values.get(keyFor(DEVICE));

  windowRef.rejectWrites();
  assert.equal(store.save(DEVICE, state(DEVICE)), false);
  assert.equal(windowRef.values.get(keyFor(DEVICE)), before);
});

test("Native Personal OrdaX store is explicitly session-scoped when storage is unavailable", () => {
  const store = createNativePersonalOrdaxStore({});
  assert.equal(store.scope, "session");
  assert.equal(store.load(USER_A), null);
  assert.equal(store.save(USER_A, state(USER_A)), true);
  assert.equal(store.load(USER_A).ownerId, "user-a");
  assert.equal(store.load(USER_B), null);
});
