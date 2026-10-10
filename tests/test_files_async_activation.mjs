import assert from "node:assert/strict";
import test from "node:test";

import { mountFileSpaceControls } from "../system/surface/ui/file-space-controls.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";

// This is the actual native Files controller, with an isolated contract port.
// No browser bundle, real user files, storage, or permission simulation.
class TestSurfaceRoot {
  constructor() {
    this.ownerDocument = {};
    this.listeners = new Map();
  }
  querySelector() { return null; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name, fn) {
    if (this.listeners.get(name) === fn) this.listeners.delete(name);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fileSpacePort(delays) {
  const listing = (path) => ({ path, entries: [] });
  return {
    schema: "ordax.file-space/11",
    list(path) { return delays.get(path)?.promise ?? Promise.resolve(listing(path)); },
    createDirectory(path) { return Promise.resolve(listing(path)); },
    readTextFile(path) { return Promise.resolve({ path, size: 0, text: "" }); },
    renameEntry(path) { return Promise.resolve(listing(path)); },
    copyFile(_source, _name, destination) { return Promise.resolve(listing(destination)); },
    moveEntry(_source, _name, destination) { return Promise.resolve(listing(destination)); },
    trashEntry(path) { return Promise.resolve(listing(path)); },
    listTrash() { return Promise.resolve({ entries: [] }); },
    restoreTrashEntry() { return Promise.resolve({ entries: [] }); },
    exportFile() { return Promise.resolve(true); },
    importFile(path) { return Promise.resolve(listing(path)); },
  };
}

test("Files activation ignores superseded failing navigation while newer request is pending", async () => {
  const originalElement = globalThis.Element;
  globalThis.Element = TestSurfaceRoot;
  let controller = null;
  try {
    const delays = new Map();
    const targets = [];
    let activation = null;
    const lifecycle = {
      schema: "ordax.surface-render-lifecycle/5",
      getAppTarget() { return null; },
      setAppTarget(appId, path) { targets.push([appId, path]); },
      subscribeRender() { return () => {}; },
      localization: {
        schema: "ordax.localization/2",
        getLocale() { return "pt-BR"; },
        getProfile() { return createLocaleProfile("pt-BR"); },
        translate(id) { return id; },
        subscribe() { return () => {}; },
      },
    };
    const root = new TestSurfaceRoot();
    const activationPort = {
      schema: "ordax.app-activation/1",
      publish() {},
      subscribe(listener) { activation = listener; return () => { activation = null; }; },
    };
    controller = mountFileSpaceControls(root, fileSpacePort(delays), activationPort, lifecycle);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.deepEqual(targets, [["files", "/"]]);
    targets.length = 0;

    const older = deferred();
    const newer = deferred();
    delays.set("/Documentos", older);
    delays.set("/Downloads", newer);
    activation({ appId: "files", target: "/Documentos" });
    activation({ appId: "files", target: "/Downloads" });
    older.reject(new Error("older navigation failed"));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(targets, [], "superseded fallback must not overwrite current target");

    newer.resolve({ path: "/Downloads", entries: [] });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(targets, [["files", "/Downloads"]]);
    assert.equal(root.listeners.size, 4);
    controller.destroy();
    controller = null;
    assert.equal(root.listeners.size, 0);
    assert.equal(activation, null);
  } finally {
    controller?.destroy();
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});
