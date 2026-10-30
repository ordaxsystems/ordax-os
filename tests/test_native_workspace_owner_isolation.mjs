import test from "node:test";
import assert from "node:assert/strict";
import { createNativeWorkspaceStore } from "../system/adapters/native/workspace.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { createDefaultWorkspaceRecord, validateWorkspaceRecord } from "../system/contracts/workspace-store.mjs";

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); },
    raw: key => values.get(key) ?? null,
  };
}
function subject(id) { return { state: "signed-in", subjectId: id, displayName: id }; }
function workspace(target) {
  const base = createDefaultWorkspaceRecord(), area = base.areas[0];
  return validateWorkspaceRecord({
    ...base,
    areas: [{
      ...area,
      windows: [{
        id: "files", appId: "files", minimized: false, maximized: false,
        placementOrdinal: 1, positionX: null, positionY: null, target,
      }],
      activeWindowId: "files", nextWindowOrdinal: 2,
    }, ...base.areas.slice(1)],
  });
}
function target(record) {
  return record.areas.flatMap(a => a.windows).find(w => w.appId === "files")?.target ?? null;
}
test("Native owner persists guest, A and B independently across reboot", () => {
  const localStorage = storage();
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner({ state: "signed-out" });
  assert.equal(store.save(workspace("/guest")), true);
  store.selectOwner(subject("A"));
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/private-A")), true);
  store.selectOwner(subject("B"));
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/private-B")), true);
  store.selectOwner({ state: "signed-out" });
  assert.equal(target(store.load()), "/guest");
  store.selectOwner(subject("A"));
  assert.equal(target(store.load()), "/private-A");
  store.selectOwner(subject("B"));
  assert.equal(target(store.load()), "/private-B");
  assert.equal(target(JSON.parse(localStorage.raw("ordax.native.workspace.v2"))), "/guest");
  const rebooted = createNativeWorkspaceStore({ localStorage });
  rebooted.selectOwner(subject("A"));
  assert.equal(target(rebooted.load()), "/private-A");
});
test("Unavailable or invalid authority fails closed without retaining A", () => {
  const store = createNativeWorkspaceStore({ localStorage: storage() });
  store.selectOwner(subject("A"));
  assert.equal(store.save(workspace("/secret-A")), true);
  store.selectOwner({ state: "unavailable" });
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/unavailable")), false);
  assert.equal(store.selectOwner({ state: "signed-in", subjectId: "B" }), false);
  assert.equal(target(store.load()), null);
  store.selectOwner(subject("A"));
  assert.equal(target(store.load()), "/secret-A");
});
test("Corrupt A partition cannot be overwritten or projected through canonical bridge", () => {
  const localStorage = storage();
  const key = "ordax.native.workspace.v2.subject.A";
  localStorage.setItem(key, "{invalid");
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner(subject("A"));
  const bridge = createWorkspaceMetadataBridge(store);
  const before = bridge.source.getSnapshot(), seen = [];
  const stop = bridge.store.subscribe(record => seen.push(target(record)));
  assert.equal(bridge.store.save(workspace("/not-accepted")), false);
  assert.equal(target(bridge.store.load()), null);
  assert.equal(bridge.source.getSnapshot(), before);
  assert.deepEqual(seen, []);
  assert.equal(localStorage.raw(key), "{invalid");
  stop();
});
test("Canonical bridge notifies A to B to A without showing the prior owner's targets", () => {
  const native = createNativeWorkspaceStore({ localStorage: storage() });
  native.selectOwner(subject("A"));
  const bridge = createWorkspaceMetadataBridge(native), seen = [];
  const stop = bridge.store.subscribe(record => seen.push(target(record)));
  bridge.store.save(workspace("/A"));
  native.selectOwner(subject("B"));
  bridge.store.load();
  assert.equal(target(bridge.store.load()), null);
  bridge.store.save(workspace("/B"));
  native.selectOwner(subject("A"));
  bridge.store.load();
  assert.deepEqual(seen, ["/A", null, "/B", "/A"]);
  stop();
});
test("Unavailable browser storage is volatile and remains partitioned", () => {
  const store = createNativeWorkspaceStore({});
  store.selectOwner(subject("A"));
  assert.equal(store.save(workspace("/volatile-A")), false);
  store.selectOwner(subject("B"));
  assert.equal(target(store.load()), null);
  store.selectOwner(subject("A"));
  assert.equal(target(store.load()), "/volatile-A");
});
