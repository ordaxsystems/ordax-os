import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { createRevocableFileSpacePort } from "../system/services/files/revocable-file-space.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { loadVerifiedCurrentComponentRuntime as load } from "../system/services/components/current-slot-loader.mjs";
import { installTrustedComponentContextProvider } from "../system/services/components/runtime-loader.mjs";

let suppliedFileSpace = null;
installTrustedComponentContextProvider(async (componentId) => componentId === "internet"
  ? Object.freeze({
    nativeAppDataMarker: "bound-by-host",
    ...(suppliedFileSpace === null ? {} : { fileSpace: suppliedFileSpace }),
  }) : null);

function filePort(list = async (path) => ({ path, entries: [] })) {
  const method = async () => ({ entries: [] });
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA, list,
    createDirectory: method, readTextFile: method, renameEntry: method,
    copyFile: method, moveEntry: method, trashEntry: method, listTrash: method,
    restoreTrashEntry: method, exportFile: method, importFile: method,
  });
}

const revision = Object.freeze({
  componentId: "internet", state: "current", source: "slot", revision: 4,
  version: "0.3.0", sourceCommit: "a".repeat(40), entrypoint: "src/runtime.mjs", pendingHealth: null,
});
const source = createNativeComponentSlotSource({
  location: { href: "http://127.0.0.1:43121/" },
});

class FakeElement {
  constructor(documentObject) {
    this.nodeType = 1;
    this.ownerDocument = documentObject;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.className = "";
    this.removed = false;
  }
  append(...children) {
    for (const child of children) {
      child.parentNode?.remove();
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  remove() {
    if (this.parentNode) {
      this.parentNode.childNodes = this.parentNode.childNodes.filter((child) => child !== this);
      this.parentNode = null;
    }
    this.removed = true;
  }
}
function makeSurfaceRoot() {
  const documentObject = {
    createElement() { return new FakeElement(documentObject); },
  };
  return new FakeElement(documentObject);
}

function fixture(states = [revision]) {
  let reads = 0, imports = 0, mounts = 0, destroys = 0, reported = null;
  const fetchImpl = async (_, options) => {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => states[Math.min(reads++, states.length - 1)] };
  };
  const importModule = async () => {
    imports++;
    return { componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.0",
      mount: async (context) => {
        assert.equal(context.nativeAppDataMarker, "bound-by-host");
        mounts++;
        return { destroy() { destroys++; } };
      },
    } };
  };
  return {
    run: (override = {}) => load({
      componentId: "internet", source, fetchImpl, importModule,
      onError(error) { reported = error; }, ...override,
    }),
    state: () => ({ reads, imports, mounts, destroys, reported }),
  };
}
test("current verified slot mounts without a local app import", async () => {
  const f = fixture();
  const mounted = await f.run();
  assert.ok(mounted);
  assert.deepEqual({ ...f.state(), reported: null }, { reads: 3, imports: 1, mounts: 1, destroys: 0, reported: null });
  mounted.destroy();
  assert.equal(f.state().destroys, 1);
});

test("DOM app runtime receives an empty per-component root and releases it on destroy", async () => {
  const f = fixture();
  const surfaceRoot = makeSurfaceRoot();
  let appRoot = null;
  let destroyed = 0;
  const mounted = await f.run({
    context: Object.freeze({ root: surfaceRoot }),
    importModule: async () => ({ componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId: "internet",
      version: "0.3.0",
      mount(context) {
        assert.equal(context.nativeAppDataMarker, "bound-by-host");
        appRoot = context.root;
        assert.notStrictEqual(appRoot, surfaceRoot);
        assert.strictEqual(appRoot.parentNode, surfaceRoot);
        assert.equal(appRoot.childNodes.length, 0);
        assert.equal(appRoot.dataset.ordaxComponentRoot, "internet");
        assert.equal(appRoot.style.display, "contents");
        const child = appRoot.ownerDocument.createElement("section");
        appRoot.append(child);
        return { destroy() { destroyed++; child.remove(); } };
      },
    } }),
  });
  assert.ok(mounted);
  assert.equal(surfaceRoot.childNodes.length, 1);
  assert.equal(appRoot.childNodes.length, 1);
  mounted.destroy();
  mounted.destroy();
  assert.equal(destroyed, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.equal(appRoot.removed, true);
});

test("invalid Surface parent root fails before metadata fetch or import", async () => {
  const f = fixture();
  assert.equal(await f.run({ context: { root: {} } }), null);
  assert.equal(f.state().reads, 0);
  assert.equal(f.state().imports, 0);
  assert.match(f.state().reported.message, /mount parent must be a Surface Element/);
});
test("absence never imports, allocates a mount root, or falls back", async () => {
  const f = fixture([{ ...revision, source: "absent", version: null, sourceCommit: null, entrypoint: null }]);
  const surfaceRoot = makeSurfaceRoot();
  assert.equal(await f.run({ context: { root: surfaceRoot } }), null);
  assert.equal(f.state().imports, 0);
  assert.equal(f.state().reported, null);
  assert.equal(surfaceRoot.childNodes.length, 0);
});
test("bundled metadata is not an external slot", async () => {
  const f = fixture([{ ...revision, source: "bundled", version: null, sourceCommit: null, entrypoint: null }]);
  assert.equal(await f.run(), null);
  assert.match(f.state().reported.message, /Bundled source/);
  assert.equal(f.state().imports, 0);
});
test("wrong identity blocks import", async () => {
  const f = fixture([{ ...revision, componentId: "notes" }]);
  assert.equal(await f.run(), null);
  assert.equal(f.state().imports, 0);
  assert.match(f.state().reported.message, /identity mismatch/);
});
test("changed slot before mount blocks execution without allocating a mount root", async () => {
  const f = fixture([revision, { ...revision, revision: 5 }]);
  const surfaceRoot = makeSurfaceRoot();
  assert.equal(await f.run({ context: { root: surfaceRoot } }), null);
  assert.equal(f.state().mounts, 0);
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.match(f.state().reported.message, /changed before mount/);
});
test("changed slot after mount destroys runtime and removes its owned mount root", async () => {
  const f = fixture([revision, revision, { ...revision, revision: 5 }]);
  const surfaceRoot = makeSurfaceRoot();
  assert.equal(await f.run({ context: { root: surfaceRoot } }), null);
  assert.equal(f.state().destroys, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.match(f.state().reported.message, /changed during mount/);
});
test("external module origin cannot be injected", async () => {
  const f = fixture();
  assert.equal(await f.run({ source: { ...source, runtimeUrl() { return "https://evil.example/runtime.mjs"; } } }), null);
  assert.equal(f.state().imports, 0);
  assert.match(f.state().reported.message, /escaped immutable Native namespace/);
});
test("malformed metadata and failed fetch block import", async () => {
  const f = fixture([{ ...revision, sourceCommit: "broken" }]);
  assert.equal(await f.run(), null);
  assert.equal(f.state().imports, 0);
  const g = fixture();
  assert.equal(await g.run({ fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(g.state().imports, 0);
});
test("runtime identity mismatch prevents mount", async () => {
  const f = fixture();
  assert.equal(await f.run({ importModule: async () => ({ componentRuntime: {
    schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.1",
    mount() { throw new Error("must not mount"); },
  } }) }), null);
  assert.equal(f.state().mounts, 0);
});

test("metadata endpoint cannot be redirected to a non-loopback host", async () => {
  const f = fixture();
  assert.equal(await f.run({ source: { ...source, metadataUrl() { return "https://evil.example/__ordax/native/component-runtime?component=internet&state=current"; } } }), null);
  assert.equal(f.state().reads, 0);
  assert.match(f.state().reported.message, /canonical Native loopback endpoint/);
});

test("module URL with additional unverified path segments is rejected", async () => {
  const f = fixture();
  const unsafe = {
    ...source,
    runtimeUrl(rec) { return source.runtimeUrl(rec).replace("/src/runtime.mjs", "/injected/src/runtime.mjs"); },
  };
  assert.equal(await f.run({ source: unsafe }), null);
  assert.equal(f.state().imports, 0);
  assert.match(f.state().reported.message, /escaped immutable Native namespace/);
});

test("a runtime resolving after mount timeout is destroyed and its owned root is removed", async () => {
  let finishMount;
  let destroyed = 0;
  const f = fixture();
  const surfaceRoot = makeSurfaceRoot();
  const pending = f.run({
    context: { root: surfaceRoot },
    timeout: 100,
    importModule: async () => ({ componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.0",
      mount() { return new Promise((resolve) => { finishMount = resolve; }); },
    } }),
  });
  assert.equal(await pending, null);
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.match(f.state().reported.message, /mount timed out/);
  finishMount({ destroy() { destroyed++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroyed, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
});

test("caller cannot shadow trusted bound Native context", async () => {
  const f = fixture();
  assert.equal(await f.run({ context: { nativeAppDataMarker: "untrusted" } }), null);
  assert.equal(f.state().mounts, 0);
  assert.match(f.state().reported.message, /cannot add field/);
});

test("a verified discovery revision is pinned before any runtime module import", async () => {
  const f = fixture();
  assert.equal(await f.run({
    expectedCurrent: { ...revision, revision: revision.revision + 1 },
  }), null);
  assert.equal(f.state().imports, 0);
  assert.equal(f.state().mounts, 0);
  assert.match(f.state().reported.message, /changed since verified discovery/);
});

test("a forged discovery identity fails before network access", async () => {
  const f = fixture();
  await assert.rejects(() => f.run({
    expectedCurrent: { ...revision, componentId: "notes" },
  }), /component identity mismatch/);
  assert.equal(f.state().reads, 0);
  assert.equal(f.state().imports, 0);
});

// The app in this fixture is deliberately not Files: this proves that the
// generic verified current-slot loader tears down ANY trusted File Space lease.
test("verified current mount cannot retain File Space after destroy", async () => {
  const host = filePort();
  suppliedFileSpace = host;
  let delivered = null;
  let destroyCalls = 0;
  try {
    const mounted = await fixture().run({
      importModule: async () => ({ componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.0",
        mount(context) {
          delivered = context.fileSpace;
          assert.notStrictEqual(delivered, host);
          assert.equal(Object.isFrozen(delivered), true);
          return { destroy() {
            destroyCalls++;
            assert.throws(() => delivered.list("/"), /revoked/);
          } };
        },
      } }),
    });
    assert.ok(mounted);
    assert.deepEqual(await delivered.list("/"), { path: "/", entries: [] });
    mounted.destroy();
    mounted.destroy();
    assert.equal(destroyCalls, 1);
    assert.throws(() => delivered.list("/"), /revoked/);
    assert.deepEqual(await host.list("/"), { path: "/", entries: [] });
  } finally {
    suppliedFileSpace = null;
  }
});

test("replaced current slot revokes leaked File Space after failed mount", async () => {
  const host = filePort();
  suppliedFileSpace = host;
  let leaked = null;
  try {
    const failed = fixture([revision, revision, { ...revision, revision: 5 }]);
    const mounted = await failed.run({
      importModule: async () => ({ componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.0",
        mount(context) {
          leaked = context.fileSpace;
          return { destroy() {} };
        },
      } }),
    });
    assert.equal(mounted, null);
    assert.match(failed.state().reported.message, /changed during mount/);
    assert.throws(() => leaked.list("/"), /revoked/);
    assert.deepEqual(await host.list("/"), { path: "/", entries: [] });
  } finally {
    suppliedFileSpace = null;
  }
});

test("late File Space results are not delivered after lease revocation", async () => {
  let complete;
  const original = filePort(() => new Promise(resolve => { complete = resolve; }));
  const lease = createRevocableFileSpacePort(original);
  const pending = lease.port.list("/");
  lease.revoke();
  lease.revoke();
  complete({ path: "/", entries: [] });
  await assert.rejects(pending, /revoked/);
  assert.throws(() => lease.port.list("/"), /revoked/);
  assert.throws(() => lease.port.importFile("/", "x", new Uint8Array()), /revoked/);
});

test("optional preview methods do not bypass the lease", async () => {
  const host = { ...filePort(), readImagePreview: async () => ({ size: 0 }) };
  const lease = createRevocableFileSpacePort(host);
  assert.deepEqual(await lease.port.readImagePreview("/picture.png"), { size: 0 });
  lease.revoke();
  assert.throws(() => lease.port.readImagePreview("/picture.png"), /revoked/);
  assert.equal(lease.port.readMediaPreview, undefined);
});
