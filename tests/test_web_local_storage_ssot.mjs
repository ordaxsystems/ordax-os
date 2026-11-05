import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebLocalStorage } from "../system/adapters/web/local-storage.mjs";
import { createWebPreferenceStore } from "../system/adapters/web/preferences.mjs";
import { createWebWorkspaceStore } from "../system/adapters/web/workspace.mjs";
import { createWebMemoryStore } from "../system/adapters/web/memory.mjs";
import { createWebSyncStateStore } from "../system/adapters/web/sync-state.mjs";
import { createWebSyncCheckpointStore } from "../system/adapters/web/sync-checkpoint.mjs";

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("Web storage SSOT returns the original compatible browser storage without wrapping data", () => {
  const persistent = storage();
  assert.equal(resolveWebLocalStorage({ localStorage: persistent }), persistent);
  assert.equal(resolveWebLocalStorage({}), null);
  assert.equal(resolveWebLocalStorage(null), null);
  assert.equal(resolveWebLocalStorage({ localStorage: { getItem() {} } }), null);
  assert.equal(resolveWebLocalStorage({ localStorage: { setItem() {} } }), null);
});

test("Web storage SSOT fails closed when browser policy denies the storage property or methods", () => {
  const denied = {};
  Object.defineProperty(denied, "localStorage", { get() { throw new Error("SecurityError"); } });
  assert.equal(resolveWebLocalStorage(denied), null);
  const broken = {};
  Object.defineProperty(broken, "localStorage", { get() {
    return { get getItem() { throw new Error("SecurityError"); }, setItem() {} };
  } });
  assert.equal(resolveWebLocalStorage(broken), null);
});

test("five Web state adapters use one optional-storage boundary without changing their semantics", () => {
  const persistent = storage();
  const windowRef = { localStorage: persistent };
  const preferences = createWebPreferenceStore(windowRef);
  assert.deepEqual(preferences.load(), {});
  assert.equal(preferences.save({ "appearance.theme": "dark" }), true);
  assert.equal(createWebPreferenceStore(windowRef).load()["appearance.theme"], "dark");

  const workspace = createWebWorkspaceStore(windowRef);
  assert.equal(workspace.schema, "ordax.workspace-store/1");
  assert.ok(workspace.load());

  const memory = createWebMemoryStore(windowRef);
  const syncState = createWebSyncStateStore(windowRef);
  const checkpoint = createWebSyncCheckpointStore(windowRef);
  assert.equal(memory.scope, "device");
  assert.equal(syncState.scope, "device");
  assert.equal(checkpoint.scope, "device");
});

test("optional Web storage denial retains explicit session fallback in every state adapter", () => {
  const denied = {};
  Object.defineProperty(denied, "localStorage", { get() { throw new Error("SecurityError"); } });
  assert.equal(createWebPreferenceStore(denied).save({ "appearance.theme": "dark" }), false);
  assert.ok(createWebWorkspaceStore(denied).load());
  assert.equal(createWebMemoryStore(denied).scope, "session");
  assert.equal(createWebSyncStateStore(denied).scope, "session");
  assert.equal(createWebSyncCheckpointStore(denied).scope, "session");
});
