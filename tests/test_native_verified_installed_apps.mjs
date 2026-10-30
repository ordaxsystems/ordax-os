import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeVerifiedInstalledAppCatalog,
  mountNativeVerifiedInstalledApps,
} from "../system/composition/native/verified-installed-apps.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { installTrustedComponentContextProvider } from "../system/services/components/runtime-loader.mjs";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";

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
  assert.equal(output.catalog.get("internet"), null, "Internet cannot be treated as bundled after Gate A");
  assert.equal(output.catalog.get("files"), null, "Files must not be a bundled OS app");
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

test("verified external Files can enter the Native slot inventory without a bundled collision", () => {
  const signedFiles = { ...item, component: { ...component, id: "files", title: "Arquivos" },
    metadata: { ...metadata, componentId: "files" },
    presentation: { ...presentation, appId: "files" } };
  const result = createNativeVerifiedInstalledAppCatalog([signedFiles, item]);
  assert.equal(result.catalog.get("files").component.owner, "ordaxsystems/ordax-apps");
  assert.equal(result.installed.length, 2);
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
  const surfaceRoot = makeSurfaceRoot();
  let mounted = 0, destroyed = 0;
  const mounts = await mountNativeVerifiedInstalledApps({
    installed, source, context: Object.freeze({ root: surfaceRoot }),
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
          assert.notStrictEqual(ctx.root, surfaceRoot);
          assert.strictEqual(ctx.root.parentNode, surfaceRoot);
          assert.equal(ctx.root.childNodes.length, 0);
          assert.equal(ctx.root.dataset.ordaxComponentRoot, "notes");
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
  assert.equal(surfaceRoot.childNodes.length, 1);
  await mounts.destroy();
  assert.equal(destroyed, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
});

test("calculator Native slot is discoverable and mountable only with reverified current identity", async () => {
  const calculator = Object.freeze({
    component: Object.freeze({
      ...component, id: "calculator", title: "Calculadora",
      version: "0.2.0", dependencies: [],
    }),
    metadata: Object.freeze({
      ...metadata, componentId: "calculator", version: "0.2.0",
      entrypoint: "system/apps/calculator/src/runtime.mjs",
    }),
    presentation: Object.freeze({
      ...presentation, appId: "calculator", appVersion: "0.2.0",
      monogram: "CL", description: "Calculadora",
    }),
  });
  const installed = createNativeVerifiedInstalledAppCatalog([calculator]).installed;
  assert.equal(installed.length, 1);
  assert.equal(installed[0].component.id, "calculator");
  const previousAppData = trustedAppData;
  trustedAppData = appDataPort("calculator");
  const loadedUrls = [];
  const surfaceRoot = makeSurfaceRoot();
  let mounts = 0;
  let destroys = 0;
  try {
    const result = await mountNativeVerifiedInstalledApps({
      installed, source, context: Object.freeze({ root: surfaceRoot }),
      onError(error) { throw error; },
      fetchImpl: async (url) => ({
        ok: true,
        json: async () => calculator.metadata,
      }),
      importModule: async (url) => {
        loadedUrls.push(url);
        return { componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "calculator", version: "0.2.0",
          mount({ root }) {
            assert.notStrictEqual(root, surfaceRoot);
            assert.strictEqual(root.parentNode, surfaceRoot);
            assert.equal(root.dataset.ordaxComponentRoot, "calculator");
            mounts += 1;
            return { destroy() { destroys += 1; } };
          },
        } };
      },
    });
    assert.equal(mounts, 1);
    assert.equal(result.mountedCount, 1);
    assert.deepEqual(result.mountedIds, ["calculator"]);
    assert.match(loadedUrls[0], /\/__ordax\/native\/component-module\/calculator\/current\/0\.2\.0\//);
    await result.destroy();
    assert.equal(destroys, 1);
    assert.equal(surfaceRoot.childNodes.length, 0);
  } finally {
    trustedAppData = previousAppData;
  }
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
    const surfaceRoot = makeSurfaceRoot();
    const runtime = await mountNativeVerifiedInstalledApps({
      installed, source, context: { root: surfaceRoot },
      fetchImpl: async () => { fetched++; throw new Error("unexpected network"); },
      importModule: async () => { imported++; throw new Error("unexpected module"); },
      onError(error) { errors.push(error); },
    });
    assert.equal(fetched, 0);
    assert.equal(imported, 0);
    assert.deepEqual(runtime.mountedIds, []);
    assert.equal(errors.length, 1);
    assert.equal(surfaceRoot.childNodes.length, 0);
  } finally {
    trustedAppData = appDataPort();
  }
});

test("mismatched trusted App Data identity is rejected before module load", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  trustedAppData = appDataPort("studio");
  try {
    const errors = [];
    const surfaceRoot = makeSurfaceRoot();
    const runtime = await mountNativeVerifiedInstalledApps({
      installed, source, context: { root: surfaceRoot },
      fetchImpl: async () => { throw new Error("must not fetch"); },
      importModule: async () => { throw new Error("must not import"); },
      onError(error) { errors.push(error); },
    });
    assert.deepEqual(runtime.mountedIds, []);
    assert.match(errors[0]?.message, /identity does not match/);
    assert.equal(surfaceRoot.childNodes.length, 0);
  } finally {
    trustedAppData = appDataPort();
  }
});

test("caller context cannot inject privileged file, AI, account or App Data ports", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  for (const key of ["fileSpace", "intelligence", "identitySessionPort", "appActivation", "appData"]) {
    await assert.rejects(
      () => mountNativeVerifiedInstalledApps({
        installed, source, context: { root: {}, [key]: {} },
      }),
      /caller context cannot supply privileged ports/,
      key,
    );
  }
});

test("inherited fields, accessors, symbols and non-enumerable grants are rejected", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  const inherited = Object.create({ fileSpace: { readTextFile() {} } });
  inherited.root = {};
  const hidden = Object.defineProperty({ root: {} }, "fileSpace", {
    enumerable: false, value: {},
  });
  const getter = Object.defineProperty({ root: {} }, "surfaceLifecycle", {
    get() { throw new Error("must not execute context getter"); },
  });
  for (const context of [inherited, hidden, getter, { root: {}, [Symbol("grant")]: 1 }]) {
    await assert.rejects(
      () => mountNativeVerifiedInstalledApps({ installed, source, context }),
      /caller context cannot supply privileged ports/,
    );
  }
});

test("full Surface object cannot be passed as an external lifecycle", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  const localization = Object.freeze({
    schema: "ordax.localization/2",
    translate() { return ""; },
    getLocale() { return "pt-BR"; },
    getProfile() { return createLocaleProfile("pt-BR"); },
    subscribe() { return () => {}; },
  });
  const scoped = {
    schema: "ordax.surface-render-lifecycle/5",
    localization,
    subscribeRender() { return () => {}; },
    getAppTarget() { return null; },
    setAppTarget() {},
  };
  await assert.rejects(
    () => mountNativeVerifiedInstalledApps({
      installed, source,
      context: { root: {}, surfaceLifecycle: { ...scoped, preferences: {} } },
    }),
    /minimal projection/,
  );
});

test("nested Surface lifecycle getters are rejected before they execute", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  let invoked = false;
  const nested = Object.defineProperty({
    schema: "ordax.surface-render-lifecycle/5",
  }, "getAppTarget", {
    enumerable: true,
    get() { invoked = true; return () => null; },
  });
  await assert.rejects(
    () => mountNativeVerifiedInstalledApps({
      installed, source, context: { root: {}, surfaceLifecycle: nested },
    }),
    /minimal projection/,
  );
  assert.equal(invoked, false);
});

test("valid minimal Surface context passes the broker without device grants", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  const localization = Object.freeze({
    schema: "ordax.localization/2",
    translate() { return ""; },
    getLocale() { return "pt-BR"; },
    getProfile() { return createLocaleProfile("pt-BR"); },
    subscribe() { return () => {}; },
  });
  const lifecycle = Object.freeze({
    schema: "ordax.surface-render-lifecycle/5",
    localization,
    subscribeRender() { return () => {}; },
    getAppTarget() { return null; },
    setAppTarget() {},
  });
  const surfaceRoot = makeSurfaceRoot();
  let sawMounted = false;
  const mounts = await mountNativeVerifiedInstalledApps({
    installed, source, context: Object.freeze({ root: surfaceRoot, surfaceLifecycle: lifecycle }),
    fetchImpl: async () => ({ ok: true, json: async () => metadata }),
    importModule: async () => ({ componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA, componentId: "notes", version: "0.4.3",
      mount(context) {
        assert.notStrictEqual(context.root, surfaceRoot);
        assert.strictEqual(context.root.parentNode, surfaceRoot);
        assert.equal(context.surfaceLifecycle, lifecycle);
        assert.equal(context.appData?.identity?.appId, "notes");
        assert.deepEqual(
          Object.keys(context).sort(),
          ["appData", "root", "surfaceLifecycle"],
        );
        sawMounted = true;
        return { destroy() {} };
      },
    } }),
  });
  assert.equal(sawMounted, true);
  assert.deepEqual(mounts.mountedIds, ["notes"]);
  assert.equal(surfaceRoot.childNodes.length, 1);
  await mounts.destroy();
  assert.equal(surfaceRoot.childNodes.length, 0);
});

test("a caller cannot inject or override the host App Data port", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  await assert.rejects(
    () => mountNativeVerifiedInstalledApps({
      installed, source, context: { root: {}, appData: appDataPort() },
    }),
    /caller context cannot supply privileged ports/,
  );
});


test("signed stateless external runtime mounts without App Data, never receiving storage authority", async () => {
  const stateless = Object.freeze({
    component: Object.freeze({ ...component, id: "assistant", title: "Aura" }),
    metadata: Object.freeze({
      ...metadata, componentId: "assistant",
      entrypoint: "system/apps/assistant/src/runtime.mjs",
    }),
    presentation: Object.freeze({ ...presentation, appId: "assistant", monogram: "AU" }),
  });
  const signedDescriptor = Object.freeze({
    schema: "ordax.component-compatibility/1",
    componentId: "assistant", componentVersion: "0.4.3",
    provides: [{ id: "ordax.component-runtime", major: 1 }],
    requires: [{ id: "ordax.identity-session", minMajor: 1, maxMajor: 1, optional: false }],
    state: null, authority: "none",
  });
  const previousAppData = trustedAppData;
  trustedAppData = null;
  try {
    const installed = createNativeVerifiedInstalledAppCatalog([stateless]).installed;
    let imported = 0, mounted = 0;
    const root = makeSurfaceRoot();
    const mounts = await mountNativeVerifiedInstalledApps({
      installed, source, context: { root },
      signedCurrentCompatibility: async (value) => {
        assert.deepEqual(value, stateless.metadata);
        return signedDescriptor;
      },
      fetchImpl: async () => ({ ok: true, json: async () => stateless.metadata }),
      importModule: async () => {
        imported++;
        return { componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA, componentId: "assistant",
          version: "0.4.3",
          mount(context) {
            assert.equal(Object.hasOwn(context, "appData"), false);
            assert.equal(context.root.dataset.ordaxComponentRoot, "assistant");
            mounted++;
            return { destroy() {} };
          },
        } };
      },
      onError(error) { throw error; },
    });
    assert.equal(imported, 1);
    assert.equal(mounted, 1);
    assert.deepEqual(mounts.mountedIds, ["assistant"]);
    await mounts.destroy();
    assert.equal(root.childNodes.length, 0);
  } finally {
    trustedAppData = previousAppData;
  }
});

test("compatibility failure and wrong component cannot bypass host App Data nor import executable", async () => {
  const installed = createNativeVerifiedInstalledAppCatalog([item]).installed;
  const previousAppData = trustedAppData;
  trustedAppData = null;
  try {
    let fetched = 0, imported = 0;
    for (const signedCurrentCompatibility of [
      async () => { throw Error("Signed sidecar missing"); },
      async () => ({
        schema: "ordax.component-compatibility/1", componentId: "studio",
        componentVersion: "0.4.3", provides: [], requires: [], state: null,
        authority: "none",
      }),
      async () => ({
        schema: "ordax.component-compatibility/1", componentId: "notes",
        componentVersion: "0.4.3", provides: [], requires: [
          { id: "ordax.app-data", minMajor: 1, maxMajor: 1, optional: false },
        ], state: null, authority: "none",
      }),
      async () => ({
        schema: "ordax.component-compatibility/1", componentId: "notes",
        componentVersion: "0.4.3", provides: [], requires: [],
        state: { id: "ordax.notes-store", writeVersion: 2, readableFrom: 1, readableThrough: 2 },
        authority: "none",
      }),
    ]) {
      const errors = [];
      const mounts = await mountNativeVerifiedInstalledApps({
        installed, source, context: { root: makeSurfaceRoot() },
        signedCurrentCompatibility,
        fetchImpl: async () => { fetched++; throw Error("unapproved fetch"); },
        importModule: async () => { imported++; throw Error("unapproved import"); },
        onError(error) { errors.push(error.message); },
      });
      assert.equal(mounts.mountedCount, 0);
      assert.equal(errors.length, 1);
    }
    assert.equal(fetched, 0);
    assert.equal(imported, 0);
  } finally {
    trustedAppData = previousAppData;
  }
});
