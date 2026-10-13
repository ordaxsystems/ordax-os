import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { defineComponentManifest } from "../system/contracts/component-manifest.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../system/services/components/runtime-loader.mjs";

const OPTIONAL_TEST_COMPONENT = defineComponentManifest({
  id: "test-optional-app",
  title: "Optional App Fixture",
  kind: "app",
  version: "0.3.0",
  releaseMode: "bundled",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "tests/test_component_runtime.mjs",
  dependencies: ["surface-shell"],
});

function createManager() {
  return createComponentManager({
    manifests: [...listSystemComponents(), OPTIONAL_TEST_COMPONENT],
    now: (() => {
      let value = 1000;
      return () => value++;
    })(),
  });
}

function healthOf(manager, componentId) {
  return manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  ).state.currentHealth;
}

test("optional component runtime mounts and reports its own health", async () => {
  const manager = createManager();
  let mountedContext = null;
  let destroyed = false;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "test-optional-app",
    componentManager: manager,
    context: { marker: "context-ok" },
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "test-optional-app",
        version: "0.3.0",
        async mount(context) {
          mountedContext = context;
          return { destroy() { destroyed = true; } };
        },
      },
    }),
  });

  assert.equal(mountedContext.marker, "context-ok");
  assert.equal(healthOf(manager, "test-optional-app"), "healthy");
  assert.notEqual(mounted, null);
  mounted.destroy();
  assert.equal(destroyed, true);
  manager.destroy();
});

test("import failure is contained inside the component failure domain", async () => {
  const manager = createManager();
  manager.setCurrentHealth("surface-shell", "healthy");
  let reported = null;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "test-optional-app",
    componentManager: manager,
    importer: async () => {
      throw new SyntaxError("broken optional runtime");
    },
    onError(error) {
      reported = error;
    },
  });

  assert.equal(mounted, null);
  assert.equal(reported?.name, "SyntaxError");
  assert.equal(healthOf(manager, "test-optional-app"), "failed");
  assert.equal(healthOf(manager, "surface-shell"), "healthy");
  manager.destroy();
});

test("runtime version mismatch fails closed without mounting stale code", async () => {
  const manager = createManager();
  let mountCalls = 0;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "test-optional-app",
    componentManager: manager,
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "test-optional-app",
        version: "0.1.0",
        mount() {
          mountCalls += 1;
          return { destroy() {} };
        },
      },
    }),
  });

  assert.equal(mounted, null);
  assert.equal(mountCalls, 0);
  assert.equal(healthOf(manager, "test-optional-app"), "failed");
  manager.destroy();
});

test("malformed mounted runtime is isolated as component failure", async () => {
  const manager = createManager();
  const mounted = await loadOptionalComponentRuntime({
    componentId: "test-optional-app",
    componentManager: manager,
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "test-optional-app",
        version: "0.3.0",
        mount() {
          return {};
        },
      },
    }),
  });

  assert.equal(mounted, null);
  assert.equal(healthOf(manager, "test-optional-app"), "failed");
  manager.destroy();
});
