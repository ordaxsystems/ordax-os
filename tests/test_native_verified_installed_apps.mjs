import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeVerifiedInstalledAppCatalog,
  mountNativeVerifiedInstalledApps,
} from "../system/composition/native/verified-installed-apps.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { installTrustedComponentContextProvider } from "../system/services/components/runtime-loader.mjs";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";

function appDataPort(appId = "notes") {
  return Object.freeze({
    schema: APP_DATA_SCHEMA,
    identity: Object.freeze({ appId, publisherId: "ordaxsystems", ownerScope: "device" }),
    get() {}, list() {}, put() {}, delete() {},
  });
}
let trustedAppData = appDataPort();
installTrustedComponentContextProvider(async () => (
  trustedAppData === null ? null : { appData: trustedAppData }
));

const sourceCommit = "7".repeat(40);
const component = Object.freeze({
  schema: "ordax.component-manifest/1", id: "notes", title: "Notas",
  kind: "app", version: "0.4.3", releaseMode: "component-slot",
  criticality: "optional", failureDomain: "app", restartScope: "component",
  healthMode: "runtime", owner: "ordaxsystems/ordax-apps", dependencies: ["surface-shell"],
});
const metadata = Object.freeze({
  componentId: "notes", state: "current", source: "slot", revision: 5,
  version: "0.4.3", sourceCommit,
  entrypoint: "system/apps/notes/src/runtime.mjs", pendingHealth: null,
});
const presentation = Object.freeze({
  schema: "ordax.app-presentation-manifest/1", appId: "notes",
  appVersion: "0.4.3", authority: "none", sourceLocale: "pt-BR",
  description: "Notas", monogram: "NT", singleton: true, translations: {},
});
const item = Object.freeze({ component, metadata, presentation });
const source = createNativeComponentSlotSource({
  location: { href: "http://127.0.0.1:43121/" },
});

test("Native installed app catalog combines OS built-ins and signed-slot presentation", () => {
  const output = createNativeVerifiedInstalledAppCatalog([item]);
  assert.equal(output.catalog.get("internet").component.owner, "system/apps/internet");
  assert.equal(output.catalog.get("notes").component.owner, "ordaxsystems/ordax-apps");
  assert.equal(output.installed.length, 1);
  assert.equal(output.catalog.get("notes").panels[0].extensionId, "notes");
  assert.ok(Object.isFrozen(output.installed));
});

test("empty installed inventory cannot create launchable external apps", () => {
  const result = createNativeVerifiedInstalledAppCatalog([]);
  assert.equal(result.catalog.get("notes"), null);
  assert.equal(result.installed.length, 0);
});

test("built-in collision remains OS-owned during remove-first transition", () => {
  const oldInternet = {
    ...item, component: {
      ...component, id: "internet", title: "Internet",
    },
    metadata: { ...metadata, componentId: "internet" },
    presentation: { ...presentation, appId: "internet" },
  };
  const output = createNativeVerifiedInstalledAppCatalog([oldInternet, item]);
  assert.equal(output.catalog.get("internet").component.owner, "system/apps/internet");
  assert.equal(output.installed.length, 1);
  assert.equal(output.installed[0].component.id, "notes");
});

test("falsified current state and owner do not enter Surface", () => {
  for (const corrupt of [
    { ...item, metadata: { ...metadata, source: "absent" } },
    { ...item, metadata: { ...metadata, version: "9.9.9" } },
    { ...item, component: { ...component, owner: "attacker" } },
  ]) {
    assert.throws(
      () => createNativeVerifiedInstalledAppCatalog([corrupt]),
      /canonical verified Native slot/,
    );
  }
});

test("verified Native component is rechecked before mount and cleaned on shutdown", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  const fetched = [];
  let mounted = 0, destroyed = 0;
  const mounts = await mountNativeVerifiedInstalledApps({
    installed, source, context: Object.freeze({ root: "root-marker" }),
    onError(error) { throw error; },
    fetchImpl: async (url) => {
      fetched.push(url);
      return { ok: true, json: async () => metadata };
    },
    importModule: async (url) => {
      assert.match(url, /__ordax\/native\/component-module\/notes\/current\/0\.4\.3\//);
      return { componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA, componentId: "notes", version: "0.4.3",
        mount(ctx) {
          assert.equal(ctx.root, "root-marker");
          mounted++;
          return { destroy() { destroyed++; } };
        },
      } };
    },
  });
  assert.equal(mounted, 1);
  assert.equal(mounts.mountedCount, 1);
  assert.deepEqual(mounts.mountedIds, ["notes"]);
  assert.equal(fetched.length, 3);
  mounts.destroy();
  assert.equal(destroyed, 1);
});

test("missing verified slot never mounts and does not abort Native startup", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  let executed = false;
  const errors = [];
  const mounts = await mountNativeVerifiedInstalledApps({
    installed, source,
    context: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({
      ...metadata, source: "absent", version: null, sourceCommit: null, entrypoint: null,
    }) }),
    importModule: async () => { executed = true; },
    onError(error) { errors.push(error.message); },
  });
  assert.equal(executed, false);
  assert.equal(mounts.mountedCount, 0);
  assert.deepEqual(mounts.mountedIds, []);
  assert.deepEqual(errors, []);
});

test("injection cannot claim an arbitrary app outside the Native module-read policy", () => {
  const candidate = {
    ...item, component: { ...component, id: "calendar" },
    metadata: { ...metadata, componentId: "calendar" },
    presentation: { ...presentation, appId: "calendar" },
  };
  assert.throws(() => createNativeVerifiedInstalledAppCatalog([candidate]),
    /canonical verified Native slot/);
});

test("missing trusted App Data prevents any external fetch or import", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  trustedAppData = null;
  try {
    let fetched = 0, imported = 0;
    const errors = [];
    const runtime = await mountNativeVerifiedInstalledApps({
      installed, source, context: { root: "root-marker" },
      fetchImpl: async () => { fetched++; throw new Error("unexpected network"); },
      importModule: async () => { imported++; throw new Error("unexpected module"); },
      onError(error) { errors.push(error); },
    });
    assert.equal(fetched, 0);
    assert.equal(imported, 0);
    assert.deepEqual(runtime.mountedIds, []);
    assert.equal(errors.length, 1);
  } finally {
    trustedAppData = appDataPort();
  }
});

test("mismatched trusted App Data identity is rejected before module load", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  trustedAppData = appDataPort("studio");
  try {
    const errors = [];
    const runtime = await mountNativeVerifiedInstalledApps({
      installed, source, context: { root: "root-marker" },
      fetchImpl: async () => { throw new Error("must not fetch"); },
      importModule: async () => { throw new Error("must not import"); },
      onError(error) { errors.push(error); },
    });
    assert.deepEqual(runtime.mountedIds, []);
    assert.match(errors[0]?.message, /identity does not match/);
  } finally {
    trustedAppData = appDataPort();
  }
});

test("a caller cannot inject or override the host App Data port", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  await assert.rejects(
    () => mountNativeVerifiedInstalledApps({
      installed, source, context: { root: {}, appData: appDataPort() },
    }),
    /caller context cannot supply App Data/,
  );
});
