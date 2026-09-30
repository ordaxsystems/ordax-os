import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferenceSnapshot,
  setPreferenceValue,
} from "../system/services/preferences/catalog.mjs";
import {
  MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
  memoryAutoCaptureEnabled,
} from "../system/services/preferences/memory.mjs";
import {
  createPreferenceBoundMemoryCaptureRuntime,
} from "../system/services/memory/capture.mjs";
import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { MEMORY_CAPTURE_AUTH_SCHEMA } from "../system/contracts/memory-capture.mjs";

function preferenceRuntime(seed = {}) {
  let snapshot = createPreferenceSnapshot(seed);
  const listeners = new Set();
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() { return snapshot; },
    set(id, value) {
      snapshot = setPreferenceValue(snapshot, id, value);
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

function memoryPort() {
  const remembered = [];
  return {
    schema: MEMORY_PORT_SCHEMA,
    remembered,
    search() { return []; },
    remember(item) {
      remembered.push(item);
      return item;
    },
    forget() { return false; },
    async flush() { return true; },
  };
}

const authorization = Object.freeze({
  schema: MEMORY_CAPTURE_AUTH_SCHEMA,
  authority: "composition",
  ownerKind: "device",
  ownerId: null,
  scope: "device",
  spaceId: null,
});

test("Memory automatic capture preference defaults on and validates exact values", () => {
  const snapshot = createPreferenceSnapshot();
  assert.equal(snapshot[MEMORY_AUTO_CAPTURE_PREFERENCE_ID], "on");
  assert.equal(memoryAutoCaptureEnabled(snapshot), true);

  const disabled = setPreferenceValue(snapshot, MEMORY_AUTO_CAPTURE_PREFERENCE_ID, "off");
  assert.equal(memoryAutoCaptureEnabled(disabled), false);
  assert.throws(
    () => setPreferenceValue(snapshot, MEMORY_AUTO_CAPTURE_PREFERENCE_ID, "maybe"),
    /Unsupported memory auto-capture preference/,
  );
});

test("preference-bound Memory capture reacts immediately to toggle changes", async () => {
  const preferences = preferenceRuntime();
  const memory = memoryPort();
  let ordinal = 0;
  const capture = createPreferenceBoundMemoryCaptureRuntime(memory, preferences, {
    idFactory: () => `pref-${++ordinal}`,
  });

  await capture.capture({
    content: "salva",
    kind: "fact",
    provenance: "intelligence",
  }, authorization);

  preferences.set(MEMORY_AUTO_CAPTURE_PREFERENCE_ID, "off");
  const blocked = await capture.capture({
    content: "não salva",
    kind: "fact",
    provenance: "intelligence",
  }, authorization);

  preferences.set(MEMORY_AUTO_CAPTURE_PREFERENCE_ID, "on");
  await capture.capture({
    content: "salva novamente",
    kind: "fact",
    provenance: "intelligence",
  }, authorization);

  assert.equal(blocked, null);
  assert.deepEqual(memory.remembered.map((item) => item.content), [
    "salva",
    "salva novamente",
  ]);
});


test("preference-bound Memory capture preserves a composition-owned persistence writer", async () => {
  const preferences = preferenceRuntime();
  const memory = memoryPort();
  const persisted = [];
  const capture = createPreferenceBoundMemoryCaptureRuntime(memory, preferences, {
    idFactory: () => "pref-protected",
    async persistItem(item) {
      persisted.push(item);
      return item;
    },
  });

  const result = await capture.capture({
    content: "writer protegido",
    kind: "fact",
    provenance: "intelligence",
  }, authorization);

  assert.equal(result.item.id, "pref-protected");
  assert.deepEqual(persisted.map((item) => item.content), ["writer protegido"]);
  assert.equal(memory.remembered.length, 0);

  preferences.set(MEMORY_AUTO_CAPTURE_PREFERENCE_ID, "off");
  const blocked = await capture.capture({
    content: "não deve chegar ao writer",
    kind: "fact",
    provenance: "intelligence",
  }, authorization);
  assert.equal(blocked, null);
  assert.equal(persisted.length, 1);
});
