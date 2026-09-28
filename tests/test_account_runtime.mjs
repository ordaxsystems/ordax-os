import test from "node:test";
import assert from "node:assert/strict";

import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { createWebSurfaceHost } from "../system/adapters/web/runtime.mjs";
import { validateAccountRuntime } from "../system/services/account/runtime.mjs";

function createWindow(onLine = false) {
  const listeners = new Map();
  return {
    navigator: { onLine },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
}

function createIdentitySession(initial = { state: "unavailable" }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: "ordax.identity-session/1",
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

test("web baseline accepts unavailable identity when account capability is not advertised", () => {
  const runtime = validateAccountRuntime(
    { capabilityIds: ["network.https"], connectivity: "online" },
    { state: "unavailable" },
    { supportedActions: [] },
  );
  assert.equal(runtime.identity.state, "unavailable");
  assert.deepEqual(runtime.actions.supportedActions, []);
});

test("sync capability requires account capability", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["sync.safe-state"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: [] },
    ),
    TypeError,
  );
});

test("available session and account capability must agree", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["account.identity"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: [] },
    ),
    TypeError,
  );
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["network.https"], connectivity: "online" },
      { state: "signed-out" },
      { supportedActions: [] },
    ),
    TypeError,
  );
  assert.doesNotThrow(() => validateAccountRuntime(
    { capabilityIds: ["account.identity"], connectivity: "online" },
    { state: "signed-out" },
    { supportedActions: [] },
  ));
});

test("identity commands cannot exist while identity is unavailable", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["network.https"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: ["sign-in"] },
    ),
    TypeError,
  );
});

test("supported command families remain provider-neutral across session states", () => {
  const capabilities = { capabilityIds: ["account.identity"], connectivity: "online" };
  assert.doesNotThrow(() => validateAccountRuntime(
    capabilities,
    { state: "signed-out" },
    { supportedActions: ["sign-in", "sign-out"] },
  ));
  assert.doesNotThrow(() => validateAccountRuntime(
    capabilities,
    { state: "signed-in", subjectId: "user-1", displayName: "User" },
    { supportedActions: ["sign-in", "sign-out"] },
  ));
});

for (const [label, createHost] of [
  ["Web", createWebSurfaceHost],
  ["Native", createNativeSurfaceHost],
]) {
  test(`${label} host derives account capabilities from the live identity session`, () => {
    const windowRef = createWindow(false);
    const identitySession = createIdentitySession();
    const host = createHost(windowRef, { identitySession });
    const observed = [];
    const unsubscribe = host.subscribe((snapshot) => observed.push(snapshot));

    assert.equal(host.getSnapshot().connectivity, "offline");
    assert.equal(host.getSnapshot().capabilityIds.includes("account.identity"), false);
    assert.equal(host.getSnapshot().capabilityIds.includes("sync.safe-state"), false);
    assert.doesNotThrow(() => validateAccountRuntime(
      host.getSnapshot(),
      identitySession.getSnapshot(),
      { supportedActions: [] },
    ));

    identitySession.setSnapshot({ state: "signed-out" });
    assert.equal(host.getSnapshot().capabilityIds.includes("account.identity"), true);
    assert.equal(host.getSnapshot().capabilityIds.includes("sync.safe-state"), true);
    assert.doesNotThrow(() => validateAccountRuntime(
      host.getSnapshot(),
      identitySession.getSnapshot(),
      { supportedActions: ["sign-in", "register"] },
    ));

    identitySession.setSnapshot({ state: "unavailable" });
    assert.equal(host.getSnapshot().capabilityIds.includes("account.identity"), false);
    assert.equal(host.getSnapshot().capabilityIds.includes("sync.safe-state"), false);
    assert.ok(observed.length >= 2);

    unsubscribe();
    host.dispose();
    const observedAfterDispose = observed.length;
    identitySession.setSnapshot({ state: "signed-out" });
    assert.equal(observed.length, observedAfterDispose);
  });

  test(`${label} host remains fail-closed without an identity session`, () => {
    const host = createHost(createWindow(true));
    assert.equal(host.getSnapshot().capabilityIds.includes("account.identity"), false);
    assert.equal(host.getSnapshot().capabilityIds.includes("sync.safe-state"), false);
    host.dispose();
  });
}
