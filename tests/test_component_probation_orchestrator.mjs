import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPONENT_PROBATION_ORCHESTRATOR_SCHEMA,
  runSystemPendingComponentProbation,
  systemComponentProbationProbeMode,
} from "../system/services/components/probation-orchestrator.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";

const COMMIT = "a".repeat(40);

function windowRef() {
  return {
    location: {
      href: "http://127.0.0.1:8765/composition/native/index.html",
    },
  };
}

function metadataResponse({
  componentId = "internet",
  version = componentId === "notes" ? "0.4.1" : "0.4.0",
  entrypoint = componentId === "notes"
    ? "system/apps/notes/src/runtime.mjs"
    : `system/apps/${componentId}/runtime.mjs`,
  ...overrides
} = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        componentId,
        state: "pending",
        source: "slot",
        revision: 7,
        version,
        sourceCommit: COMMIT,
        entrypoint,
        pendingHealth: "unknown",
        ...overrides,
      };
    },
  };
}

function runtimeModule({
  componentId = "internet",
  version = componentId === "notes" ? "0.4.1" : "0.4.0",
  mount = async () => ({ destroy() {} }),
} = {}) {
  return {
    componentRuntime: Object.freeze({
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId,
      version,
      mount,
    }),
  };
}

test("system probation exposes fixed probes only for explicit supported components", () => {
  assert.equal(COMPONENT_PROBATION_ORCHESTRATOR_SCHEMA, "ordax.component-probation-orchestrator/1");
  assert.equal(systemComponentProbationProbeMode("internet"), "import-contract");
  assert.equal(systemComponentProbationProbeMode("notes"), "import-contract");
  assert.throws(
    () => systemComponentProbationProbeMode("assistant"),
    /Unsupported system component probation probe/,
  );
});

test("system probation owns Internet source, namespace and health probe", async () => {
  const fetched = [];
  const imported = [];
  const result = await runSystemPendingComponentProbation({
    componentId: "internet",
    source: createNativeComponentSlotSource(windowRef()),
    fetchImpl: async (url, options) => {
      fetched.push({ url, options });
      return metadataResponse();
    },
    importModule: async (url) => {
      imported.push(url);
      return runtimeModule();
    },
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "internet");
  assert.equal(result.version, "0.4.0");
  assert.equal(result.sourceCommit, COMMIT);
  assert.equal(result.revision, 7);
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /\/__ordax\/native\/component-runtime\?component=internet&state=pending$/);
  assert.equal(fetched[0].options.method, "GET");
  assert.equal(fetched[0].options.cache, "no-store");
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

test("Notes probation imports the external component contract without mounting the app", async () => {
  const fetched = [];
  const imported = [];
  let mountCalls = 0;
  const module = runtimeModule({
    componentId: "notes",
    version: "0.4.1",
    mount: async () => {
      mountCalls += 1;
      return { destroy() {} };
    },
  });

  const result = await runSystemPendingComponentProbation({
    componentId: "notes",
    source: createNativeComponentSlotSource(windowRef()),
    fetchImpl: async (url, options) => {
      fetched.push({ url, options });
      return metadataResponse({ componentId: "notes", version: "0.4.1" });
    },
    importModule: async (url) => {
      imported.push(url);
      return module;
    },
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "notes");
  assert.equal(result.version, "0.4.1");
  assert.equal(result.sourceCommit, COMMIT);
  assert.equal(result.revision, 7);
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(mountCalls, 0);
  assert.match(fetched[0].url, /component=notes&state=pending$/);
  assert.match(
    imported[0],
    new RegExp(
      "/__ordax/native/component-module/notes/pending/0\\.4\\.1/"
      + COMMIT
      + "/system/apps/notes/src/runtime\\.mjs$",
    ),
  );
});

test("import failure becomes a failed receipt bound to the same pending identity", async () => {
  const result = await runSystemPendingComponentProbation({
    componentId: "internet",
    source: createNativeComponentSlotSource(windowRef()),
    fetchImpl: async () => metadataResponse(),
    importModule: async () => {
      throw new SyntaxError("candidate import failed");
    },
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "internet");
  assert.equal(result.version, "0.4.0");
  assert.equal(result.sourceCommit, COMMIT);
  assert.equal(result.revision, 7);
  assert.equal(result.health, "failed");
  assert.equal(result.probeMode, "import-contract");
  assert.match(result.error, /candidate import failed/);
});

test("missing pending metadata is non-actionable and never fabricates identity", async () => {
  const result = await runSystemPendingComponentProbation({
    componentId: "internet",
    source: createNativeComponentSlotSource(windowRef()),
    fetchImpl: async () => ({ ok: false, status: 404, async json() { return {}; } }),
    importModule: async () => runtimeModule(),
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "internet");
  assert.equal(result.version, null);
  assert.equal(result.sourceCommit, null);
  assert.equal(result.revision, null);
  assert.equal(result.health, "failed");
  assert.equal(result.probeMode, "import-contract");
});

test("runtime identity mismatch is recorded as failed before probe success", async () => {
  const result = await runSystemPendingComponentProbation({
    componentId: "internet",
    source: createNativeComponentSlotSource(windowRef()),
    fetchImpl: async () => metadataResponse(),
    importModule: async () => runtimeModule({ version: "0.3.0" }),
    timeoutMs: 500,
  });

  assert.equal(result.health, "failed");
  assert.equal(result.revision, 7);
  assert.match(result.error, /runtime version mismatch/i);
});
