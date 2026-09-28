import assert from "node:assert/strict";
import test from "node:test";

import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";

function createWindowStub({ online = true } = {}) {
  const listeners = new Map();
  return {
    navigator: { onLine: online },
    addEventListener(kind, listener) {
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind).add(listener);
    },
    removeEventListener(kind, listener) {
      listeners.get(kind)?.delete(listener);
    },
    emit(kind) {
      for (const listener of [...(listeners.get(kind) ?? [])]) listener();
    },
    listenerCount(kind) {
      return listeners.get(kind)?.size ?? 0;
    },
  };
}

test("Native host refreshes account and sync capabilities from live readers", () => {
  const windowRef = createWindowStub();
  let identityAvailable = false;
  const host = createNativeSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => identityAvailable,
    readSyncSafeStateAvailable: () => identityAvailable,
  });
  const observed = [];
  const unsubscribe = host.subscribe((snapshot) => observed.push(snapshot));

  assert.deepEqual(host.getSnapshot().capabilityIds, ["surface.render", "network.https"]);

  identityAvailable = true;
  const refreshed = host.refresh();
  assert.ok(refreshed.capabilityIds.includes("account.identity"));
  assert.ok(refreshed.capabilityIds.includes("sync.safe-state"));
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], refreshed);

  identityAvailable = false;
  host.refresh();
  assert.equal(observed.length, 2);
  assert.ok(!observed[1].capabilityIds.includes("account.identity"));
  assert.ok(!observed[1].capabilityIds.includes("sync.safe-state"));

  unsubscribe();
  host.dispose();
});

test("Native host never exposes sync without account identity", () => {
  const windowRef = createWindowStub();
  const host = createNativeSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => false,
    readSyncSafeStateAvailable: () => true,
  });

  assert.throws(
    () => host.getSnapshot(),
    /sync\.safe-state requires account\.identity/,
  );
  host.dispose();
});

test("Native host connectivity notifications use current capability readers", () => {
  const windowRef = createWindowStub({ online: true });
  let identityAvailable = false;
  const host = createNativeSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => identityAvailable,
    readSyncSafeStateAvailable: () => identityAvailable,
  });
  const observed = [];
  host.subscribe((snapshot) => observed.push(snapshot));

  identityAvailable = true;
  windowRef.navigator.onLine = false;
  windowRef.emit("offline");

  assert.equal(observed.length, 1);
  assert.equal(observed[0].connectivity, "offline");
  assert.ok(observed[0].capabilityIds.includes("account.identity"));
  assert.ok(observed[0].capabilityIds.includes("sync.safe-state"));

  host.dispose();
  assert.equal(windowRef.listenerCount("online"), 0);
  assert.equal(windowRef.listenerCount("offline"), 0);
});

test("Native host rejects non-boolean dynamic availability", () => {
  const host = createNativeSurfaceHost(createWindowStub(), {
    readAccountIdentityAvailable: () => "yes",
  });
  assert.throws(
    () => host.getSnapshot(),
    /account identity availability reader must return a boolean/,
  );
  host.dispose();
});
