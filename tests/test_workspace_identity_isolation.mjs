import test from "node:test";
import assert from "node:assert/strict";

import { createNativeWorkspaceStore } from "../system/adapters/native/workspace.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { createSurfaceState, createWorkspaceSnapshot, reduceSurfaceState } from "../system/surface/ui/surface-state.mjs";
import { createDefaultWorkspaceRecord } from "../system/contracts/workspace-store.mjs";

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); },
    raw: key => values.get(key) ?? null,
  };
}
function subject(id) {
  return { state: "signed-in", subjectId: id, displayName: id };
}
function windowRecord(target) {
  let state = createSurfaceState({ capabilityIds: [], connectivity: "online" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files", target });
  return createWorkspaceSnapshot(state);
}
function fileTarget(record) {
  return record.areas.flatMap(a => a.windows).find(w => w.appId === "files")?.target ?? null;
}

test("Native workspace guest and signed-in accounts never reuse another subject's window target", () => {
  const localStorage = storage();
  const store = createNativeWorkspaceStore({ localStorage });
  const guest = windowRecord("/guest-only");
  const a = windowRecord("/account-A-private");
  const b = windowRecord("/account-B-private");
  store.save(guest);
  assert.equal(fileTarget(store.load()), "/guest-only");
  assert.equal(store.selectOwner(subject("account-A")), true);
  assert.equal(fileTarget(store.load()), null);
  store.save(a);
  assert.equal(store.selectOwner(subject("account-B")), true);
  assert.equal(fileTarget(store.load()), null);
  store.save(b);
  store.selectOwner({ state: "signed-out" });
  assert.equal(fileTarget(store.load()), "/guest-only");
  store.selectOwner(subject("account-A"));
  assert.equal(fileTarget(store.load()), "/account-A-private");
  store.selectOwner(subject("account-B"));
  assert.equal(fileTarget(store.load()), "/account-B-private");
  assert.equal(fileTarget(JSON.parse(localStorage.raw("ordax.native.workspace.v2"))), "/guest-only");
  assert.equal(fileTarget(JSON.parse(localStorage.raw("ordax.native.workspace.v2.subject.account-A"))), "/account-A-private");
  assert.equal(fileTarget(JSON.parse(localStorage.raw("ordax.native.workspace.v2.subject.account-B"))), "/account-B-private");
  const rebooted = createNativeWorkspaceStore({ localStorage });
  rebooted.selectOwner(subject("account-A"));
  assert.equal(fileTarget(rebooted.load()), "/account-A-private", "reboot must restore exact owner partition");
});

test("unavailable identity fails closed to guest state rather than revealing last signed-in workspace", () => {
  const store = createNativeWorkspaceStore({ localStorage: storage() });
  store.selectOwner(subject("account-A"));
  store.save(windowRecord("/secret-A"));
  assert.equal(store.selectOwner({ state: "unavailable" }), true);
  assert.equal(fileTarget(store.load()), null);
  assert.equal(store.selectOwner(subject("account-A")), true);
  assert.equal(fileTarget(store.load()), "/secret-A");
});

test("legacy Native workspace remains guest-only after an identity signs in", () => {
  const localStorage = storage();
  const legacy = {
    windows: [{
      id: "files", appId: "files", minimized: false, maximized: false,
      placementOrdinal: 1, positionX: 10, positionY: 20,
    }],
    activeWindowId: "files", nextWindowOrdinal: 2,
  };
  localStorage.setItem("ordax.native.workspace.v1", JSON.stringify(legacy));
  const store = createNativeWorkspaceStore({ localStorage });
  assert.equal(fileTarget(store.load()), null);
  assert.equal(store.load().areas[0].windows.length, 1);
  store.selectOwner(subject("account-A"));
  assert.equal(store.load().areas[0].windows.length, 0, "legacy guest windows must not migrate to account A");
  store.selectOwner({ state: "signed-out" });
  assert.equal(store.load().areas[0].windows.length, 1);
  assert.ok(localStorage.raw("ordax.native.workspace.v1"), "original evidence is retained");
});

test("corrupt account partition is never overwritten by normal UI saves", () => {
  const localStorage = storage();
  const key = "ordax.native.workspace.v2.subject.account-A";
  localStorage.setItem(key, "{corrupt-account-workspace");
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner(subject("account-A"));
  assert.deepEqual(store.load(), createDefaultWorkspaceRecord());
  assert.equal(store.save(windowRecord("/would-destroy-evidence")), false);
  assert.equal(localStorage.raw(key), "{corrupt-account-workspace");
  store.selectOwner(subject("account-B"));
  assert.equal(store.save(windowRecord("/B-allowed")), true);
  store.selectOwner(subject("account-A"));
  assert.equal(fileTarget(store.load()), null);
  assert.equal(localStorage.raw(key), "{corrupt-account-workspace");
});

test("store unavailability permits only volatile partitioned workspace, never durable claims", () => {
  const store = createNativeWorkspaceStore({});
  store.selectOwner(subject("account-A"));
  assert.equal(store.save(windowRecord("/volatile-A")), false);
  store.selectOwner(subject("account-B"));
  assert.equal(fileTarget(store.load()), null);
  store.selectOwner(subject("account-A"));
  assert.equal(fileTarget(store.load()), "/volatile-A");
});

test("workspace identity switching and remote restore use one store and replace Surface windows", () => {
  const native = createNativeWorkspaceStore({ localStorage: storage() });
  const bridge = createWorkspaceMetadataBridge(native);
  let surface = createSurfaceState({ capabilityIds: [], connectivity: "online" });
  const changes = [];
  const stop = bridge.store.subscribe(record => {
    surface = reduceSurfaceState(surface, { type: "workspace.restore", workspace: record });
    changes.push(fileTarget(createWorkspaceSnapshot(surface)));
  });
  bridge.store.save(windowRecord("/guest"));
  assert.equal(fileTarget(createWorkspaceSnapshot(surface)), "/guest");
  native.selectOwner(subject("account-A"));
  bridge.store.load();
  assert.equal(fileTarget(createWorkspaceSnapshot(surface)), null);
  const accountA = windowRecord("/remote-A");
  bridge.store.save(accountA);
  assert.equal(fileTarget(createWorkspaceSnapshot(surface)), "/remote-A");
  native.selectOwner(subject("account-B"));
  bridge.store.load();
  assert.equal(fileTarget(createWorkspaceSnapshot(surface)), null);
  const afterGuest = changes.length;
  stop();
  bridge.store.save(windowRecord("/remote-B"));
  assert.equal(changes.length, afterGuest, "disposal must remove live workspace listener");
});

test("rejected Native account write cannot publish a phantom workspace or cloud metadata", () => {
  const localStorage = storage();
  const key = "ordax.native.workspace.v2.subject.account-A";
  localStorage.setItem(key, "{corrupt-account-workspace");
  const native = createNativeWorkspaceStore({ localStorage });
  native.selectOwner(subject("account-A"));
  const bridge = createWorkspaceMetadataBridge(native);
  const metadataBefore = bridge.source.getSnapshot();
  const seenWorkspaces = [];
  const seenMetadata = [];
  const stopWindow = bridge.store.subscribe(record => seenWorkspaces.push(fileTarget(record)));
  const stopMetadata = bridge.source.subscribe(snapshot => seenMetadata.push(snapshot));
  assert.equal(bridge.store.save(windowRecord("/A-forged-or-rejected")), false);
  assert.equal(fileTarget(bridge.store.load()), null);
  assert.equal(bridge.source.getSnapshot(), metadataBefore);
  assert.deepEqual(seenWorkspaces, [], "a refused write must not publish a workspace update");
  assert.deepEqual(seenMetadata, [metadataBefore], "cloud metadata cannot reflect rejected window state");
  assert.equal(localStorage.raw(key), "{corrupt-account-workspace");
  stopWindow();
  stopMetadata();
});

test("volatile Native workspace is still reflected by the canonical bridge without durable storage", () => {
  const native = createNativeWorkspaceStore({});
  native.selectOwner(subject("account-A"));
  const bridge = createWorkspaceMetadataBridge(native);
  const seen = [];
  const stop = bridge.store.subscribe(record => seen.push(fileTarget(record)));
  assert.equal(bridge.store.save(windowRecord("/volatile-but-local")), false);
  assert.equal(fileTarget(bridge.store.load()), "/volatile-but-local");
  assert.deepEqual(seen, ["/volatile-but-local"]);
  stop();
});
