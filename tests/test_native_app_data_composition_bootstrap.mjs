import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";
import {
  installTrustedComponentContextProvider,
  loadOptionalComponentRuntime,
} from "../system/services/components/runtime-loader.mjs";

function createManager() {
  return createComponentManager({
    manifests: listSystemComponents(),
    now: (() => {
      let value = 1000;
      return () => value++;
    })(),
  });
}

test("privileged bootstrap injects only ordax.app-data/1 without a DOM event channel", async () => {
  const bridgeRequests = [];
  const transportRequests = [];
  const previous = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
    webkit: globalThis.webkit,
    fetch: globalThis.fetch,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
  };

  globalThis.webkit = {
    messageHandlers: {
      ordaxBrowser: {
        postMessage(raw) {
          bridgeRequests.push(JSON.parse(raw));
        },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    transportRequests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          revision: 0,
          keys: [],
          bytesUsed: 0,
          quotaBytes: 8 * 1024 * 1024,
          maxKeys: 1024,
        };
      },
    };
  };
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

  try {
    const module = await import(`../system/composition/native/app-data-bootstrap.mjs?test=${Date.now()}`);
    assert.deepEqual(bridgeRequests, [{ type: "app-data.bootstrap.request" }]);
    assert.equal(JSON.stringify(bridgeRequests).includes("publisherId"), false);
    assert.equal(JSON.stringify(bridgeRequests).includes("appId"), false);

    module.acceptTrustedNativeAppDataBootstrap({
      schema: "ordax.native-app-data-composition-bootstrap/1",
      bindings: [
        {
          appId: "files",
          endpoint: `/__ordax/native/app-data/${"a".repeat(43)}`,
          ownerScope: "device",
          publisherId: "ordax-official",
        },
      ],
    });
    assert.throws(
      () => module.acceptTrustedNativeAppDataBootstrap({
        schema: "ordax.native-app-data-composition-bootstrap/1",
        bindings: [],
      }),
      /already consumed/,
    );

    installTrustedComponentContextProvider((componentId) => (
      componentId === "files"
        ? Object.freeze({
            companionPort: Object.freeze({
              schema: "test.trusted-companion/1",
              componentId,
            }),
          })
        : null
    ));

    const manager = createManager();
    const files = manager.getSnapshot().components.find(
      (component) => component.manifest.id === "files",
    );
    let mountedContext = null;
    const mounted = await loadOptionalComponentRuntime({
      componentId: "files",
      componentManager: manager,
      context: Object.freeze({ marker: "caller-context" }),
      importer: async () => ({
        componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "files",
          version: files.manifest.version,
          async mount(context) {
            mountedContext = context;
            return { destroy() {} };
          },
        },
      }),
    });

    assert.notEqual(mounted, null);
    assert.equal(mountedContext.marker, "caller-context");
    assert.equal(Object.isFrozen(mountedContext), true);
    assert.equal(mountedContext.appData.schema, APP_DATA_SCHEMA);
    assert.equal(mountedContext.appData.identity.appId, "files");
    assert.equal(mountedContext.appData.identity.publisherId, "ordax-official");
    assert.deepEqual(mountedContext.companionPort, {
      schema: "test.trusted-companion/1",
      componentId: "files",
    });
    assert.equal("endpoint" in mountedContext.appData, false);
    assert.equal("store" in mountedContext.appData, false);

    await mountedContext.appData.list();
    assert.equal(transportRequests.length, 1);
    assert.equal(
      transportRequests[0].url,
      `/__ordax/native/app-data/${"a".repeat(43)}`,
    );
    assert.deepEqual(JSON.parse(transportRequests[0].options.body), { action: "list" });
    assert.equal(transportRequests[0].options.body.includes("publisherId"), false);
    assert.equal(transportRequests[0].options.body.includes("appId"), false);
    manager.destroy();
  } finally {
    globalThis.clearTimeout = previous.clearTimeout;
    globalThis.setTimeout = previous.setTimeout;
    if (previous.webkit === undefined) delete globalThis.webkit;
    else globalThis.webkit = previous.webkit;
    globalThis.fetch = previous.fetch;
    if (previous.btoa === undefined) delete globalThis.btoa;
    else globalThis.btoa = previous.btoa;
    if (previous.atob === undefined) delete globalThis.atob;
    else globalThis.atob = previous.atob;
  }
});
