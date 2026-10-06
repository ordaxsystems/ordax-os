import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_COMPONENT_PROBATION_SCHEMA,
  runNativePendingComponentProbation,
} from "../system/composition/native/component-probation.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";

const COMMIT = "b".repeat(40);

function windowRef() {
  return {
    location: {
      href: "http://127.0.0.1:8765/composition/native/index.html",
    },
  };
}

test("Native probation composition wires adapter and pure service", async () => {
  const fetched = [];
  const imported = [];
  const result = await runNativePendingComponentProbation({
    componentId: "internet",
    windowRef: windowRef(),
    fetchImpl: async (url, options) => {
      fetched.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            componentId: "internet",
            state: "pending",
            source: "slot",
            sourceRepository: "washingtonmsdj/prototipo-ordax-os",
            revision: 11,
            version: "0.4.0",
            sourceCommit: COMMIT,
            entrypoint: "system/apps/internet/runtime.mjs",
            pendingHealth: "unknown",
          };
        },
      };
    },
    importModule: async (url) => {
      imported.push(url);
      return {
        componentRuntime: Object.freeze({
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "internet",
          version: "0.4.0",
          async mount() {
            return { destroy() {} };
          },
        }),
      };
    },
    timeoutMs: 500,
  });

  assert.equal(NATIVE_COMPONENT_PROBATION_SCHEMA, "ordax.native-component-probation/1");
  assert.equal(result.componentId, "internet");
  assert.equal(result.revision, 11);
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(fetched.length, 1);
  assert.equal(imported.length, 1);
  assert.match(
    imported[0],
    new RegExp(
      "/__ordax/native/component-module/internet/pending/0\\.4\\.0/"
      + COMMIT
      + "/system/apps/internet/runtime\\.mjs$",
    ),
  );
});

test("Native probation composition preserves non-actionable missing pending", async () => {
  const result = await runNativePendingComponentProbation({
    componentId: "internet",
    windowRef: windowRef(),
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async json() { return {}; },
    }),
    importModule: async () => {
      throw new Error("must not import without metadata");
    },
    timeoutMs: 500,
  });

  assert.equal(result.version, null);
  assert.equal(result.sourceCommit, null);
  assert.equal(result.revision, null);
  assert.equal(result.health, "failed");
});
