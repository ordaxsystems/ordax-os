import test from "node:test";
import assert from "node:assert/strict";

import { deriveAccountSurfaceCapabilityIds, validateAccountRuntime } from "../system/services/account/runtime.mjs";
import { createWebSurfaceHost } from "../system/adapters/web/runtime.mjs";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";

function browser() {
  const listeners = new Map();
  return {
    navigator: { onLine: true },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    listeners,
  };
}

test("Account domain projects only observed identity and sync, without grants", () => {
  const expected = [
    { identity: false, sync: false, ids: [] },
    { identity: true, sync: false, ids: ["account.identity"] },
    { identity: true, sync: true, ids: ["account.identity", "sync.safe-state"] },
  ];
  for (const { identity, sync, ids } of expected) {
    const result = deriveAccountSurfaceCapabilityIds({
      accountIdentityAvailable: identity,
      syncSafeStateAvailable: sync,
    });
    assert.deepEqual(result, ids);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.keys(result).some(key => /authority|grant|permission/.test(key)), false);
  }
  assert.throws(() => deriveAccountSurfaceCapabilityIds({
    accountIdentityAvailable: false,
    syncSafeStateAvailable: true,
  }), /sync\.safe-state requires account\.identity/);
  for (const value of [undefined, null, 1, "yes"]) {
    assert.throws(() => deriveAccountSurfaceCapabilityIds({
      accountIdentityAvailable: value, syncSafeStateAvailable: false,
    }), /account identity availability reader must return a boolean/);
    assert.throws(() => deriveAccountSurfaceCapabilityIds({
      accountIdentityAvailable: true, syncSafeStateAvailable: value,
    }), /sync availability reader must return a boolean/);
  }
});

test("Web and Native consume the same Account capability order, not parallel policies", () => {
  for (const identity of [false, true]) {
    for (const sync of [false, true]) {
      const windowWeb = browser();
      const windowNative = browser();
      const opts = {
        readAccountIdentityAvailable: () => identity,
        readSyncSafeStateAvailable: () => sync,
      };
      const web = createWebSurfaceHost(windowWeb, opts);
      const native = createNativeSurfaceHost(windowNative, opts);
      try {
        if (sync && !identity) {
          assert.throws(() => web.getSnapshot(), /sync\.safe-state requires account\.identity/);
          assert.throws(() => native.getSnapshot(), /sync\.safe-state requires account\.identity/);
        } else {
          const ids = deriveAccountSurfaceCapabilityIds({
            accountIdentityAvailable: identity, syncSafeStateAvailable: sync,
          });
          assert.deepEqual(web.getSnapshot().capabilityIds.slice(1), ids);
          assert.deepEqual(native.getSnapshot().capabilityIds.slice(2), ids);
        }
      } finally {
        web.dispose(); native.dispose();
      }
      assert.equal(windowWeb.listeners.size, 0);
      assert.equal(windowNative.listeners.size, 0);
    }
  }
});

test("Account runtime continues to reject sync without identity", () => {
  assert.throws(() => validateAccountRuntime(
    { capabilityIds: ["sync.safe-state"], connectivity: "online" },
    { state: "unavailable" },
  ), /sync\.safe-state requires account\.identity/);
});
