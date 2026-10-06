import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";

let loaderSerial = 0;

function createManager() {
  return createComponentManager({
    manifests: listSystemComponents(),
    now: (() => {
      let value = 1000;
      return () => value++;
    })(),
  });
}

function versionOf(manager, componentId) {
  return manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  ).manifest.version;
}

function healthOf(manager, componentId) {
  return manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  ).state.currentHealth;
}

async function isolatedLoader(label) {
  return import(
    `../system/services/components/runtime-loader.mjs?trusted-context=${label}-${loaderSerial += 1}`
  );
}

function runtimeModule(componentId, version, mount) {
  return {
    componentRuntime: {
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId,
      version,
      mount,
    },
  };
}

test("trusted component context composes multiple contributors without replacing caller fields", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("compose");
  const manager = createManager();
  const calls = [];
  let mountedContext = null;

  installTrustedComponentContextProvider(async (componentId) => {
    calls.push(["app-data", componentId]);
    return Object.freeze({
      appData: Object.freeze({ schema: "test.app-data" }),
    });
  });
  installTrustedComponentContextProvider(async (componentId) => {
    calls.push(["application-actions", componentId]);
    return Object.freeze({
      applicationActionProviderHostRegistration: Object.freeze({
        schema: "test.application-action-host-registration",
      }),
    });
  });

  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    context: Object.freeze({ marker: "caller" }),
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async (context) => {
        mountedContext = context;
        return { destroy() {} };
      },
    ),
  });

  assert.notEqual(mounted, null);
  assert.deepEqual(calls, [
    ["app-data", "internet"],
    ["application-actions", "internet"],
  ]);
  assert.equal(mountedContext.marker, "caller");
  assert.equal(mountedContext.appData.schema, "test.app-data");
  assert.equal(
    mountedContext.applicationActionProviderHostRegistration.schema,
    "test.application-action-host-registration",
  );
  assert.equal(Object.isFrozen(mountedContext), true);
  assert.equal(healthOf(manager, "internet"), "healthy");
  manager.destroy();
});

test("trusted component context fails closed when contributors collide", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("collision");
  const manager = createManager();
  let mounted = false;
  let reported = null;

  installTrustedComponentContextProvider(() => ({ shared: "first" }));
  installTrustedComponentContextProvider(() => ({ shared: "second" }));

  const result = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async () => {
        mounted = true;
        return { destroy() {} };
      },
    ),
    onError(error) {
      reported = error;
    },
  });

  assert.equal(result, null);
  assert.equal(mounted, false);
  assert.match(reported?.message ?? "", /cannot add field: shared/);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});

test("trusted component context cannot replace explicit caller context", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("caller-collision");
  const manager = createManager();
  let mounted = false;

  installTrustedComponentContextProvider(() => ({ marker: "trusted" }));

  const result = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    context: Object.freeze({ marker: "caller" }),
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async () => {
        mounted = true;
        return { destroy() {} };
      },
    ),
  });

  assert.equal(result, null);
  assert.equal(mounted, false);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});

test("trusted component context contributors are bounded, unique and frozen before loading begins", async () => {
  const { installTrustedComponentContextProvider } = await isolatedLoader("bounds");
  const provider = () => null;
  installTrustedComponentContextProvider(provider);
  assert.throws(
    () => installTrustedComponentContextProvider(provider),
    /already installed/,
  );

  for (let index = 1; index < 16; index += 1) {
    installTrustedComponentContextProvider(() => null);
  }
  assert.throws(
    () => installTrustedComponentContextProvider(() => null),
    /limit reached/,
  );
});

test("trusted component context cannot be extended after component loading starts", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("sealed");
  const manager = createManager();

  installTrustedComponentContextProvider(() => ({ first: true }));
  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async () => ({ destroy() {} }),
    ),
  });
  assert.notEqual(mounted, null);

  assert.throws(
    () => installTrustedComponentContextProvider(() => ({ later: true })),
    /cannot be installed after app loading starts/,
  );
  manager.destroy();
});

test("trusted component context rejects non-plain or oversized contributor payloads", async () => {
  {
    const {
      installTrustedComponentContextProvider,
      loadOptionalComponentRuntime,
    } = await isolatedLoader("non-plain");
    const manager = createManager();
    installTrustedComponentContextProvider(() => new Date());
    const mounted = await loadOptionalComponentRuntime({
      componentId: "internet",
      componentManager: manager,
      importer: async () => runtimeModule(
        "internet",
        versionOf(manager, "internet"),
        async () => ({ destroy() {} }),
      ),
    });
    assert.equal(mounted, null);
    assert.equal(healthOf(manager, "internet"), "failed");
    manager.destroy();
  }

  {
    const {
      installTrustedComponentContextProvider,
      loadOptionalComponentRuntime,
    } = await isolatedLoader("oversized");
    const manager = createManager();
    installTrustedComponentContextProvider(() => Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`field${index}`, index]),
    ));
    const mounted = await loadOptionalComponentRuntime({
      componentId: "internet",
      componentManager: manager,
      importer: async () => runtimeModule(
        "internet",
        versionOf(manager, "internet"),
        async () => ({ destroy() {} }),
      ),
    });
    assert.equal(mounted, null);
    assert.equal(healthOf(manager, "internet"), "failed");
    manager.destroy();
  }
});

test("trusted component context rejects prototype-sensitive field names", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("prototype-fields");
  const manager = createManager();
  installTrustedComponentContextProvider(() => Object.defineProperty(
    {},
    "__proto__",
    { value: "blocked", enumerable: true },
  ));

  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async () => ({ destroy() {} }),
    ),
  });
  assert.equal(mounted, null);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});

test("trusted component context rejects symbol-keyed contributor fields", async () => {
  const {
    installTrustedComponentContextProvider,
    loadOptionalComponentRuntime,
  } = await isolatedLoader("symbol-fields");
  const manager = createManager();
  const hidden = Symbol("hidden");
  installTrustedComponentContextProvider(() => ({
    visible: true,
    [hidden]: "must-not-cross-boundary",
  }));

  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => runtimeModule(
      "internet",
      versionOf(manager, "internet"),
      async () => ({ destroy() {} }),
    ),
  });

  assert.equal(mounted, null);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});
