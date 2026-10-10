import assert from "node:assert/strict";
import test from "node:test";

import {
  validateComponentRuntimeMetadata,
} from "../system/contracts/component-runtime-metadata.mjs";

const SHA = "a".repeat(40);

function currentSlot(overrides = {}) {
  return {
    componentId: "notes",
    state: "current",
    source: "slot",
    revision: 7,
    version: "0.4.3",
    sourceCommit: SHA,
    entrypoint: "system/apps/notes/src/runtime.mjs",
    pendingHealth: null,
    ...overrides,
  };
}

test("component runtime metadata validates exact current slot identity", () => {
  const value = validateComponentRuntimeMetadata(currentSlot(), {
    componentId: "notes",
    state: "current",
  });
  assert.equal(value.source, "slot");
  assert.equal(value.version, "0.4.3");
  assert.equal(value.sourceCommit, SHA);
});

test("component runtime metadata accepts explicit current absence and bundled fallback only without slot identity", () => {
  for (const source of ["absent", "bundled", "removed"]) {
    const value = validateComponentRuntimeMetadata({
      componentId: "notes",
      state: "current",
      source,
      revision: 3,
      version: null,
      sourceCommit: null,
      entrypoint: null,
      pendingHealth: null,
    });
    assert.equal(value.source, source);
    assert.equal(value.version, null);
  }
});

test("component runtime metadata rejects identity drift, extra fields and impossible non-slot pending state", () => {
  assert.throws(
    () => validateComponentRuntimeMetadata(currentSlot(), { componentId: "studio" }),
    /identity mismatch/,
  );
  assert.throws(
    () => validateComponentRuntimeMetadata({ ...currentSlot(), authority: "install" }),
    /fields are not canonical/,
  );
  assert.throws(
    () => validateComponentRuntimeMetadata({
      componentId: "notes",
      state: "pending",
      source: "absent",
      revision: 3,
      version: null,
      sourceCommit: null,
      entrypoint: null,
      pendingHealth: null,
    }),
    /Non-slot.*inconsistent/,
  );
  assert.throws(
    () => validateComponentRuntimeMetadata(currentSlot({ pendingHealth: "healthy" })),
    /cannot carry pending health/,
  );
});
