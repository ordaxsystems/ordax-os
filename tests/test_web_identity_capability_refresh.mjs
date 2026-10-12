import assert from "node:assert/strict";
import test from "node:test";

import { createWebSurfaceHost } from "../system/adapters/web/runtime.mjs";

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

test("Web host refreshes account and sync capabilities from live readers", () => {
  const windowRef = createWindowStub();
  let identityAvailable = false;
  const host = createWebSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => identityAvailable,
    readSyncSafeStateAvailable: () => identityAvailable,
  });
  const observed = [];
  const unsubscribe = host.subscribe((snapshot) => observed.push(snapshot));

  assert.deepEqual(host.getSnapshot().capabilityIds, ["network.https"]);

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

test("Web host never exposes sync without account identity", () => {
  const host = createWebSurfaceHost(createWindowStub(), {
    readAccountIdentityAvailable: () => false,
    readSyncSafeStateAvailable: () => true,
  });
  assert.throws(
    () => host.getSnapshot(),
    /sync\.safe-state requires account\.identity/,
  );
  host.dispose();
});

test("Web connectivity notifications use current capability readers", () => {
  const windowRef = createWindowStub({ online: true });
  let identityAvailable = false;
  const host = createWebSurfaceHost(windowRef, {
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

test("Web host rejects non-boolean dynamic availability", () => {
  const host = createWebSurfaceHost(createWindowStub(), {
    readAccountIdentityAvailable: () => "yes",
  });
  assert.throws(
    () => host.getSnapshot(),
    /account identity availability reader must return a boolean/,
  );
  host.dispose();
});

test("Web Surface snapshots stay stable until capabilities or connectivity change", () => {
  const windowRef = createWindowStub();
  const host = createWebSurfaceHost(windowRef);
  try {
    const first = host.getSnapshot();
    assert.equal(host.getSnapshot(), first);
    assert.equal(host.refresh(), first);
    const observed = [];
    host.subscribe(snapshot => observed.push(snapshot));
    windowRef.emit("online");
    assert.equal(observed.length, 0);
    windowRef.navigator.onLine = false;
    windowRef.emit("offline");
    const offline = host.getSnapshot();
    assert.notEqual(offline, first);
    assert.equal(offline.connectivity, "offline");
    assert.equal(host.getSnapshot(), offline);
    windowRef.emit("offline");
    assert.equal(observed.length, 1);
  } finally { host.dispose(); }
});

test("Absent browser connectivity is unknown, not offline or proof of a reachable host", () => {
  const windowRef = createWindowStub();
  delete windowRef.navigator.onLine;
  const host = createWebSurfaceHost(windowRef);
  try { assert.equal(host.getSnapshot().connectivity, "unknown"); }
  finally { host.dispose(); }
});

test("Disposed Surface host retains the last snapshot without reading capabilities or subscribing", () => {
  const windowRef = createWindowStub();
  let reads = 0;
  const host = createWebSurfaceHost(windowRef, { readAccountIdentityAvailable: () => { reads++; return false; } });
  const last = host.getSnapshot();
  host.dispose();
  const count = reads;
  host.subscribe(() => { throw Error("Disposed subscriber called"); });
  windowRef.navigator.onLine = false;
  windowRef.emit("offline");
  assert.equal(host.refresh(), last);
  assert.equal(host.getSnapshot(), last);
  assert.equal(reads, count);
  assert.equal(windowRef.listenerCount("online"), 0);
  assert.equal(windowRef.listenerCount("offline"), 0);
});
