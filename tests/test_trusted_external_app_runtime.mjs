import assert from "node:assert/strict";
import test from "node:test";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import {
  installTrustedComponentContextProvider,
  loadTrustedCurrentExternalAppRuntime,
} from "../system/services/components/runtime-loader.mjs";

const SOURCE_COMMIT = "b".repeat(40);
const metadata = Object.freeze({
  componentId: "notes",
  state: "current",
  source: "slot",
  revision: 4,
  version: "0.4.3",
  sourceCommit: SOURCE_COMMIT,
  entrypoint: "system/apps/notes/src/runtime.mjs",
  pendingHealth: null,
});
const source = createNativeComponentSlotSource({
  location: { href: "http://127.0.0.1:43121/" },
});

function portFor(appId) {
  return Object.freeze({
    schema: APP_DATA_SCHEMA,
    identity: Object.freeze({ appId, publisherId: "ordaxsystems", ownerScope: "device" }),
    async get() { return null; },
    async list() { return []; },
    async put() { return null; },
    async delete() { return null; },
  });
}
let injected = null;
installTrustedComponentContextProvider(async () => (
  injected === null ? null : { appData: injected }
));

function fixture() {
  let fetches = 0, imports = 0, mounts = 0, destroys = 0, errors = [];
  let context = null;
  return {
    args: {
      componentId: "notes",
      source,
      fetchImpl: async (_, request) => {
        assert.equal(request.credentials, "same-origin");
        fetches++;
        return { ok: true, status: 200, async json() { return metadata; } };
      },
      importModule: async (url) => {
        imports++;
        assert.match(url, /\/__ordax\/native\/component-module\/notes\/current\/0\.4\.3\//);
        return {
          componentRuntime: {
            schema: COMPONENT_RUNTIME_SCHEMA,
            componentId: "notes",
            version: "0.4.3",
            async mount(value) {
              mounts++;
              context = value;
              return { destroy() { destroys++; } };
            },
          },
        };
      },
      context: Object.freeze({ root: { id: "surface" } }),
      onError(error) { errors.push(error); },
    },
    counts() { return { fetches, imports, mounts, destroys, errors, context }; },
  };
}

test("trusted App Data must be bound before even reading or importing installed code", async () => {
  injected = null;
  const f = fixture();
  assert.equal(await loadTrustedCurrentExternalAppRuntime(f.args), null);
  assert.equal(f.counts().imports, 0);
  assert.equal(f.counts().fetches, 0);
  assert.equal(f.counts().errors.length, 1);
});

test("a bound App Data port authorizes a verified immutable current-slot load", async () => {
  injected = portFor("notes");
  const f = fixture();
  const mounted = await loadTrustedCurrentExternalAppRuntime(f.args);
  assert.ok(mounted);
  assert.equal(f.counts().imports, 1);
  assert.equal(f.counts().fetches, 3);
  assert.equal(f.counts().mounts, 1);
  assert.equal(f.counts().context.appData, injected);
  assert.equal(f.counts().context.root.id, "surface");
  mounted.destroy();
  assert.equal(f.counts().destroys, 1);
});

test("wrong-app App Data binding fails before any external source reads", async () => {
  injected = portFor("studio");
  const f = fixture();
  assert.equal(await loadTrustedCurrentExternalAppRuntime(f.args), null);
  assert.equal(f.counts().fetches, 0);
  assert.equal(f.counts().imports, 0);
  assert.match(f.counts().errors[0].message, /identity is not bound/);
});

test("UI cannot forge App Data and unsupported external ids cannot load", async () => {
  injected = portFor("notes");
  const f = fixture();
  await assert.rejects(
    () => loadTrustedCurrentExternalAppRuntime({
      ...f.args, context: { root: {}, appData: portFor("notes") },
    }),
    /cannot supply App Data/,
  );
  await assert.rejects(
    () => loadTrustedCurrentExternalAppRuntime({ ...f.args, componentId: "files" }),
    /not allowed by the Native module-read policy/,
  );
  assert.equal(f.counts().imports, 0);
});
