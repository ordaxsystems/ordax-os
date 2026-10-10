import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { loadVerifiedCurrentComponentRuntime as load } from "../system/services/components/current-slot-loader.mjs";

const revision = Object.freeze({
  componentId: "internet", state: "current", source: "slot", revision: 4,
  version: "0.3.0", sourceCommit: "a".repeat(40), entrypoint: "src/runtime.mjs", pendingHealth: null,
});
const source = createNativeComponentSlotSource({
  location: { href: "http://127.0.0.1:43121/" },
});
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
      mount: async () => { mounts++; return { destroy() { destroys++; } }; },
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
test("absence never imports or falls back", async () => {
  const f = fixture([{ ...revision, source: "absent", version: null, sourceCommit: null, entrypoint: null }]);
  assert.equal(await f.run(), null);
  assert.equal(f.state().imports, 0);
  assert.equal(f.state().reported, null);
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
test("changed slot before mount blocks execution", async () => {
  const f = fixture([revision, { ...revision, revision: 5 }]);
  assert.equal(await f.run(), null);
  assert.equal(f.state().mounts, 0);
  assert.match(f.state().reported.message, /changed before mount/);
});
test("changed slot after mount destroys runtime", async () => {
  const f = fixture([revision, revision, { ...revision, revision: 5 }]);
  assert.equal(await f.run(), null);
  assert.equal(f.state().destroys, 1);
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

test("a runtime resolving after mount timeout is destroyed, not leaked", async () => {
  let finishMount;
  let destroyed = 0;
  const f = fixture();
  const pending = f.run({
    timeout: 100,
    importModule: async () => ({ componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet", version: "0.3.0",
      mount() { return new Promise((resolve) => { finishMount = resolve; }); },
    } }),
  });
  assert.equal(await pending, null);
  assert.match(f.state().reported.message, /mount timed out/);
  finishMount({ destroy() { destroyed++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroyed, 1);
});
