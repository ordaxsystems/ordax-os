import assert from "node:assert/strict";
import test from "node:test";

import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { createWebSurfaceHost } from "../system/adapters/web/runtime.mjs";

function createWindowRef() {
  const listeners = new Map();
  return {
    navigator: { onLine: false },
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
}

function createIdentitySession(initialState = "unavailable") {
  let snapshot = Object.freeze({ state: initialState });
  const listeners = new Set();
  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setState(state) {
      snapshot = Object.freeze({ state });
      for (const listener of [...listeners]) listener(snapshot);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function capabilityIds(host) {
  return new Set(host.getSnapshot().capabilityIds);
}

for (const [label, createHost] of [
  ["native", (windowRef, identitySession) => createNativeSurfaceHost(windowRef, { identitySession })],
  ["web", (windowRef, identitySession) => createWebSurfaceHost(windowRef, { identitySession })],
]) {
  test(`${label} host follows live identity availability instead of boot-time state`, () => {
    const windowRef = createWindowRef();
    const identitySession = createIdentitySession("unavailable");
    const host = createHost(windowRef, identitySession);
    const observed = [];
    const unsubscribe = host.subscribe((snapshot) => observed.push(snapshot));

    let capabilities = capabilityIds(host);
    assert.equal(capabilities.has("account.identity"), false);
    assert.equal(capabilities.has("sync.safe-state"), false);

    identitySession.setState("signed-out");
    capabilities = capabilityIds(host);
    assert.equal(capabilities.has("account.identity"), true);
    assert.equal(capabilities.has("sync.safe-state"), true);
    assert.equal(observed.length, 1);

    identitySession.setState("signed-in");
    capabilities = capabilityIds(host);
    assert.equal(capabilities.has("account.identity"), true);
    assert.equal(capabilities.has("sync.safe-state"), true);
    assert.equal(observed.length, 2);

    identitySession.setState("unavailable");
    capabilities = capabilityIds(host);
    assert.equal(capabilities.has("account.identity"), false);
    assert.equal(capabilities.has("sync.safe-state"), false);
    assert.equal(observed.length, 3);

    unsubscribe();
    host.dispose();
    assert.equal(identitySession.listenerCount(), 0);
    identitySession.setState("signed-out");
    assert.equal(observed.length, 3);
  });
}

test("hosts reject missing or malformed identity session ports", () => {
  const windowRef = createWindowRef();
  assert.throws(
    () => createNativeSurfaceHost(windowRef),
    /identity session port/,
  );
  assert.throws(
    () => createWebSurfaceHost(windowRef, { identitySession: {} }),
    /identity session port/,
  );
});
