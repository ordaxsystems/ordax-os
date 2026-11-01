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
    removeItem(key) { values.delete(key); },
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
  assert.equal(target(JSON.parse(localStorage.raw("ordax.native.workspace.v2.guest"))), "/guest");
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


test("Direct first write cannot erase an unread corrupt account partition", () => {
  const localStorage = storage();
  localStorage.setItem("ordax.native.workspace.v2.subject.A", "{unread-corrupt");
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner(subject("A"));
  assert.equal(store.save(workspace("/overwrite")), false);
  assert.equal(localStorage.raw("ordax.native.workspace.v2.subject.A"), "{unread-corrupt");
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/retry")), false);
});
test("Unavailable identity must not reveal even a populated guest partition", () => {
  const localStorage = storage();
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner({ state: "signed-out" });
  assert.equal(store.save(workspace("/private-guest")), true);
  store.selectOwner(subject("A"));
  store.save(workspace("/secret-A"));
  store.selectOwner({ state: "unavailable" });
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/unauthorized")), false);
  store.selectOwner({ state: "signed-out" });
  assert.equal(target(store.load()), "/private-guest");
});
test("Interrupted durable write does not assert persistence or cross subject boundaries", () => {
  const backing = storage();
  const localStorage = {
    getItem: backing.getItem,
    setItem() { throw new Error("read-only filesystem"); },
  };
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner(subject("A"));
  assert.equal(store.save(workspace("/volatile-A")), false);
  assert.equal(target(store.load()), "/volatile-A");
  store.selectOwner(subject("B"));
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/volatile-B")), false);
  store.selectOwner(subject("A"));
  assert.equal(target(store.load()), "/volatile-A");
});

test("Failed overwrite of a previously persisted owner remains volatile, not falsely durable", () => {
  const backing = storage();
  let writesBlocked = false;
  const localStorage = {
    getItem: backing.getItem,
    setItem(key, value) {
      if (writesBlocked) throw new Error("filesystem is read-only");
      backing.setItem(key, value);
    },
  };
  const store = createNativeWorkspaceStore({ localStorage });
  store.selectOwner(subject("A"));
  const bridge = createWorkspaceMetadataBridge(store);
  assert.equal(bridge.store.save(workspace("/durable-A")), true);
  writesBlocked = true;
  assert.equal(bridge.store.save(workspace("/volatile-A")), false);
  assert.equal(target(bridge.store.load()), "/volatile-A");
  store.selectOwner(subject("B"));
  assert.equal(target(bridge.store.load()), null);
  store.selectOwner(subject("A"));
  assert.equal(target(bridge.store.load()), "/volatile-A");
  const rebooted = createNativeWorkspaceStore({ localStorage });
  rebooted.selectOwner(subject("A"));
  assert.equal(target(rebooted.load()), "/durable-A", "reboot cannot claim a failed write survived");
  assert.equal(backing.raw("ordax.native.workspace.v2.subject.B"), null);
});

test("Durable partition removal invalidates cache; corrupt disk still blocks volatile fallback", () => {
  const localStorage = storage();
  const store = createNativeWorkspaceStore({ localStorage });
  const key = "ordax.native.workspace.v2.subject.A";
  store.selectOwner(subject("A"));
  assert.equal(store.save(workspace("/persisted-A")), true);
  localStorage.removeItem(key);
  assert.equal(target(store.load()), null, "deleted durable data must not return from cache");

  // Validate persistent bytes even if this owner has an unsaved volatile edit.
  const backend = storage();
  let blocked = false;
  const guarded = {
    getItem: backend.getItem,
    setItem(key, value) {
      if (blocked) throw new Error("write rejected");
      backend.setItem(key, value);
    },
  };
  const checked = createNativeWorkspaceStore({ localStorage: guarded });
  checked.selectOwner(subject("A"));
  assert.equal(checked.save(workspace("/old")), true);
  blocked = true;
  assert.equal(checked.save(workspace("/unsaved")), false);
  backend.setItem(key, "{corrupt");
  assert.equal(target(checked.load()), null);
  assert.equal(checked.save(workspace("/must-not-overwrite")), false);
  assert.equal(backend.raw(key), "{corrupt");
});

test("Unowned historical v2 and v1 workspaces are quarantined, never disclosed to signed-out guest", () => {
  const localStorage = storage();
  const legacyV2 = JSON.stringify(workspace("/previous-signed-in-account"));
  const old = workspace("/prior-v1-owner").areas[0];
  const legacyV1 = JSON.stringify({
    windows: old.windows, activeWindowId: old.activeWindowId, nextWindowOrdinal: old.nextWindowOrdinal,
  });
  localStorage.setItem("ordax.native.workspace.v2", legacyV2);
  localStorage.setItem("ordax.native.workspace.v1", legacyV1);
  const native = createNativeWorkspaceStore({ localStorage });
  assert.equal(target(native.load()), null, "identity is initially unavailable");
  assert.equal(native.save(workspace("/unauthenticated")), false);
  native.selectOwner({ state: "signed-out" });
  assert.equal(target(native.load()), null, "legacy v2 is not proven to belong to guest");
  native.selectOwner(subject("account-A"));
  assert.equal(target(native.load()), null, "legacy v2 is not proven to belong to account A");
  native.selectOwner({ state: "signed-out" });
  assert.equal(native.save(workspace("/new-guest")), true);
  assert.equal(target(native.load()), "/new-guest");
  assert.equal(localStorage.raw("ordax.native.workspace.v2"), legacyV2);
  assert.equal(localStorage.raw("ordax.native.workspace.v1"), legacyV1);
  assert.equal(target(JSON.parse(localStorage.raw("ordax.native.workspace.v2.guest"))), "/new-guest");
  const reopened = createNativeWorkspaceStore({ localStorage });
  reopened.selectOwner({ state: "signed-out" });
  assert.equal(target(reopened.load()), "/new-guest");
});

test("Unreadable stored record blocks cached and unsaved owner data instead of guessing authority", () => {
  const backing = storage();
  let unreadable = false;
  const localStorage = {
    getItem(key) {
      if (unreadable && key === "ordax.native.workspace.v2.subject.A") throw new Error("storage denied");
      return backing.getItem(key);
    },
    setItem: backing.setItem,
  };
  const native = createNativeWorkspaceStore({ localStorage });
  native.selectOwner(subject("A"));
  assert.equal(native.save(workspace("/previous-A")), true);
  unreadable = true;
  assert.equal(target(native.load()), null, "cached A must not override an unreadable disk partition");
  assert.equal(native.save(workspace("/overwrite-A")), false);
  unreadable = false;
  assert.equal(target(native.load()), null, "a blocked partition cannot silently recover");
  assert.equal(backing.raw("ordax.native.workspace.v2.subject.A") !== null, true);
  native.selectOwner(subject("B"));
  assert.equal(native.save(workspace("/separate-B")), true);
  assert.equal(target(native.load()), "/separate-B");
});

test("No verified session never defaults to the guest partition", () => {
  const localStorage = storage();
  const store = createNativeWorkspaceStore({ localStorage });
  assert.equal(store.save(workspace("/pre-session")), false);
  assert.equal(target(store.load()), null);
  assert.equal(localStorage.raw("ordax.native.workspace.v2.guest"), null);
  store.selectOwner({ state: "signed-out" });
  assert.equal(store.save(workspace("/proven-guest")), true);
  store.selectOwner({ state: "unavailable" });
  assert.equal(target(store.load()), null);
  assert.equal(store.save(workspace("/post-unavailable")), false);
  store.selectOwner({ state: "signed-out" });
  assert.equal(target(store.load()), "/proven-guest");
});
