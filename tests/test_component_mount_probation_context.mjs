import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import {
  NATIVE_COMPONENT_PROBATION_IDS,
  NATIVE_COMPONENT_PROBE_MODE_BY_ID,
} from "../system/services/components/probation-policy.generated.mjs";
import { COMPONENT_MOUNT_HEALTH_PROBE_MODE } from "../system/services/components/runtime-mount-health-probe.mjs";
import { runSystemPendingComponentProbation } from "../system/services/components/probation-orchestrator.mjs";

const COMMIT = "a".repeat(40);

function windowRef() {
  return {
    location: {
      href: "http://127.0.0.1:8765/composition/native/index.html",
    },
  };
}

function metadataResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        componentId: "notes",
        state: "pending",
        source: "slot",
        revision: 9,
        version: "0.4.1",
        sourceCommit: COMMIT,
        entrypoint: "system/apps/notes/src/runtime.mjs",
        pendingHealth: "unknown",
      };
    },
  };
}

function notesRuntime() {
  return {
    componentRuntime: Object.freeze({
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId: "notes",
      version: "0.4.1",
      async mount() {
        throw new Error("import-contract must never mount Notes");
      },
    }),
  };
}

test("mount-contract wiring exists without granting Files probation", async () => {
  assert.equal(COMPONENT_MOUNT_HEALTH_PROBE_MODE, "mount-contract");
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("files"), false);
  assert.equal(Object.hasOwn(NATIVE_COMPONENT_PROBE_MODE_BY_ID, "files"), false);

  const orchestrator = readFileSync(
    new URL("../system/services/components/probation-orchestrator.mjs", import.meta.url),
    "utf8",
  );
  const nativeComposition = readFileSync(
    new URL("../system/composition/native/component-probation.mjs", import.meta.url),
    "utf8",
  );
  const browserHost = readFileSync(
    new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url),
    "utf8",
  );
  assert.match(orchestrator, /createRuntimeMountHealthCheck/);
  assert.match(orchestrator, /mode === COMPONENT_MOUNT_HEALTH_PROBE_MODE/);
  assert.match(orchestrator, /mountContext/);
  assert.match(nativeComposition, /mountContext/);
  assert.doesNotMatch(browserHost, /mountContext/);

  const fetched = [];
  const imported = [];
  await assert.rejects(
    () => runSystemPendingComponentProbation({
      componentId: "files",
      source: createNativeComponentSlotSource(windowRef()),
      mountContext: Object.freeze({ root: Object.freeze({ fake: true }) }),
      fetchImpl: async (url) => {
        fetched.push(url);
        throw new Error("Files policy rejection must happen before fetch");
      },
      importModule: async (url) => {
        imported.push(url);
        throw new Error("Files policy rejection must happen before import");
      },
      timeoutMs: 500,
    }),
    /Unsupported system component probation probe/,
  );
  assert.deepEqual(fetched, []);
  assert.deepEqual(imported, []);
});

test("import-contract probation cannot be upgraded by injecting mount context", async () => {
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.notes, "import-contract");
  const imported = [];
  const result = await runSystemPendingComponentProbation({
    componentId: "notes",
    source: createNativeComponentSlotSource(windowRef()),
    mountContext: Object.freeze({ root: "invalid-on-purpose" }),
    fetchImpl: async () => metadataResponse(),
    importModule: async (url) => {
      imported.push(url);
      return notesRuntime();
    },
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "notes");
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(imported.length, 1);
});
