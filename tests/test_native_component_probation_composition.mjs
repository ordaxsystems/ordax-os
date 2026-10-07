import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("Native probation composition defers platform dependencies into the guarded attempt", async () => {
  const source = await readFile(
    new URL("../system/composition/native/component-probation.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /^import .*component-slot-source\.mjs/m);
  assert.doesNotMatch(source, /^import .*probation-orchestrator\.mjs/m);
  assert.match(source, /async function loadProbationDependencies\(\)/);
  assert.match(
    source,
    /import\("\.\.\/\.\.\/adapters\/native\/component-slot-source\.mjs"\)/,
  );
  assert.match(
    source,
    /import\("\.\.\/\.\.\/services\/components\/probation-orchestrator\.mjs"\)/,
  );
});

test("Native host converts wrapper import failure into component-bound failed receipts", async () => {
  const source = await readFile(
    new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url),
    "utf8",
  );

  const importNeedle = "module = await import('/composition/native/component-probation.mjs');";
  const importIndex = source.indexOf(importNeedle);
  const loopIndex = source.indexOf("for (const [componentId, nonce] of Object.entries(attempts))", importIndex);
  assert.ok(importIndex > 0, "probation wrapper import must exist");
  assert.ok(loopIndex > importIndex, "wrapper import must resolve before component attempts");
  assert.match(source.slice(importIndex - 80, importIndex + importNeedle.length + 120), /try \{\{[\s\S]*module = await import[\s\S]*moduleError = error/);
  assert.match(source.slice(loopIndex, loopIndex + 500), /if \(moduleError\) \{\{\s*throw moduleError;/);
  assert.match(source.slice(loopIndex, loopIndex + 1200), /componentId,[\s\S]*health: 'failed',[\s\S]*nonce,[\s\S]*result/);
});
