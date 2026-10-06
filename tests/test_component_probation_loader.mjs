import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPONENT_PROBATION_RESULT_SCHEMA,
  runPendingComponentProbation,
} from "../system/services/components/probation-loader.mjs";
import { COMPONENT_SLOT_SOURCE_SCHEMA } from "../system/contracts/component-slot-source.mjs";
import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";

const COMMIT = "a".repeat(40);

function source({
  version = "0.4.0",
  pendingHealth = "unknown",
  componentId = "internet",
} = {}) {
  return Object.freeze({
    schema: COMPONENT_SLOT_SOURCE_SCHEMA,
    metadataUrl(id, state) {
      return `http://127.0.0.1:31337/__ordax/native/component-runtime?component=${id}&state=${state}`;
    },
    runtimeUrl(resolution) {
      return (
        "http://127.0.0.1:31337/__ordax/native/component-module/"
        + `${resolution.componentId}/${resolution.state}/${resolution.version}/`
        + `${resolution.sourceCommit}/${resolution.entrypoint}`
      );
    },
    resolution: {
      componentId,
      state: "pending",
      source: "slot",
      sourceRepository: "washingtonmsdj/prototipo-ordax-os",
      revision: 7,
      version,
      sourceCommit: COMMIT,
      entrypoint: "system/apps/internet/runtime.mjs",
      pendingHealth,
    },
  });
}

function fetchFor(slotSource) {
  return async (_url, options) => ({
    ok: true,
    status: 200,
    options,
    async json() {
      return slotSource.resolution;
    },
  });
}

function moduleFor({ componentId = "internet", version = "0.4.0" } = {}) {
  return {
    componentRuntime: Object.freeze({
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId,
      version,
      async mount() {
        throw new Error("probation loader must not mount runtime directly");
      },
    }),
  };
}

test("pending probation imports exact identity-bound module and returns healthy receipt", async () => {
  const slotSource = source();
  const imports = [];
  const healthInputs = [];
  const result = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: fetchFor(slotSource),
    importModule: async (url) => {
      imports.push(url);
      return moduleFor();
    },
    healthCheck: async (value) => {
      healthInputs.push(value);
      return "healthy";
    },
    timeoutMs: 500,
  });

  assert.deepEqual(result, {
    schema: COMPONENT_PROBATION_RESULT_SCHEMA,
    componentId: "internet",
    version: "0.4.0",
    sourceCommit: COMMIT,
    revision: 7,
    health: "healthy",
  });
  assert.equal(imports.length, 1);
  assert.match(
    imports[0],
    new RegExp(
      "/component-module/internet/pending/0\\.4\\.0/"
      + COMMIT
      + "/system/apps/internet/runtime\\.mjs$",
    ),
  );
  assert.equal(healthInputs.length, 1);
  assert.equal(healthInputs[0].resolution.pendingHealth, "unknown");
  assert.equal(healthInputs[0].runtime.version, "0.4.0");
  assert.equal(Object.hasOwn(healthInputs[0], "componentManager"), false);
});

test("probation refuses pending slots whose health is no longer unknown", async () => {
  for (const pendingHealth of ["healthy", "failed"]) {
    const slotSource = source({ pendingHealth });
    let imported = false;
    const result = await runPendingComponentProbation({
      componentId: "internet",
      source: slotSource,
      fetchImpl: fetchFor(slotSource),
      importModule: async () => {
        imported = true;
        return moduleFor();
      },
      healthCheck: async () => "healthy",
      timeoutMs: 500,
    });
    assert.equal(result.health, "failed");
    assert.match(result.error, /unknown-health pending slot/);
    assert.equal(imported, false);
  }
});

test("probation rejects component runtime version or id mismatch before health check", async () => {
  for (const runtime of [
    moduleFor({ version: "0.3.0" }),
    moduleFor({ componentId: "notes" }),
  ]) {
    const slotSource = source();
    let healthCalled = false;
    const result = await runPendingComponentProbation({
      componentId: "internet",
      source: slotSource,
      fetchImpl: fetchFor(slotSource),
      importModule: async () => runtime,
      healthCheck: async () => {
        healthCalled = true;
        return "healthy";
      },
      timeoutMs: 500,
    });
    assert.equal(result.health, "failed");
    assert.equal(healthCalled, false);
  }
});

test("probation turns import or health exceptions into failed receipts without throwing", async () => {
  const slotSource = source();
  const importFailure = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: fetchFor(slotSource),
    importModule: async () => {
      throw new Error("import failed");
    },
    healthCheck: async () => "healthy",
    timeoutMs: 500,
  });
  assert.equal(importFailure.health, "failed");
  assert.match(importFailure.error, /import failed/);

  const healthFailure = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: fetchFor(slotSource),
    importModule: async () => moduleFor(),
    healthCheck: async () => {
      throw new Error("probe failed");
    },
    timeoutMs: 500,
  });
  assert.equal(healthFailure.health, "failed");
  assert.match(healthFailure.error, /probe failed/);
});

test("probation timeout fails closed and never reports healthy", async () => {
  const slotSource = source();
  const result = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: fetchFor(slotSource),
    importModule: async () => moduleFor(),
    healthCheck: async () => new Promise(() => {}),
    timeoutMs: 100,
  });
  assert.equal(result.health, "failed");
  assert.match(result.error, /timed out/);
});

test("probation rejects malformed metadata before importing module", async () => {
  const slotSource = source();
  let imported = false;
  const result = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          ...slotSource.resolution,
          sourceCommit: "not-a-sha",
        };
      },
    }),
    importModule: async () => {
      imported = true;
      return moduleFor();
    },
    healthCheck: async () => "healthy",
    timeoutMs: 500,
  });
  assert.equal(result.health, "failed");
  assert.equal(imported, false);
});

test("probation only accepts explicit healthy or failed health result", async () => {
  const slotSource = source();
  const result = await runPendingComponentProbation({
    componentId: "internet",
    source: slotSource,
    fetchImpl: fetchFor(slotSource),
    importModule: async () => moduleFor(),
    healthCheck: async () => true,
    timeoutMs: 500,
  });
  assert.equal(result.health, "failed");
  assert.match(result.error, /must return healthy or failed/);
});
