import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferenceSnapshot,
  listPreferenceDefinitions,
  recoverPreferenceSnapshot,
} from "../system/services/preferences/catalog.mjs";
import { resolveRegionalTimeZone } from "../system/services/preferences/regional.mjs";
import { createWebPreferenceStore } from "../system/adapters/web/preferences.mjs";

const REGIONAL_DEFAULTS = Object.freeze({
  "regional.locale": "pt-BR",
  "regional.time-zone": "America/Bahia",
});

function expectedPreferences(values = {}) {
  return {
    "appearance.theme": "light",
    "memory.auto-capture": "on",
    "accessibility.contrast": "standard",
    "accessibility.motion": "standard",
    "accessibility.text-scale": "standard",
    ...REGIONAL_DEFAULTS,
    ...values,
  };
}

class FakeStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("Web preference store survives a new adapter instance", () => {
  const storage = new FakeStorage();
  const windowRef = { localStorage: storage };
  const first = createWebPreferenceStore(windowRef);
  assert.deepEqual(first.load(), {});
  assert.equal(first.save(createPreferenceSnapshot({ "appearance.theme": "dark" })), true);

  const second = createWebPreferenceStore(windowRef);
  assert.deepEqual(second.load(), expectedPreferences({ "appearance.theme": "dark" }));
});

test("corrupt browser storage falls back without inventing preferences", () => {
  const storage = new FakeStorage();
  storage.setItem("ordax.preferences.v1", "{not-json");
  const store = createWebPreferenceStore({ localStorage: storage });
  assert.deepEqual(store.load(), {});
});

test("denied browser storage degrades to session memory", () => {
  const windowRef = {};
  Object.defineProperty(windowRef, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const store = createWebPreferenceStore(windowRef);
  const snapshot = createPreferenceSnapshot({ "appearance.theme": "dark" });
  assert.equal(store.save(snapshot), false);
  assert.deepEqual(store.load(), expectedPreferences({ "appearance.theme": "dark" }));
});

test("persisted invalid known values recover to safe defaults", () => {
  assert.deepEqual(
    recoverPreferenceSnapshot({ "appearance.theme": "sepia" }),
    expectedPreferences(),
  );
});

test("runtime preference mutation still rejects unsupported values", () => {
  assert.throws(
    () => createPreferenceSnapshot({ "appearance.theme": "sepia" }),
    /Unsupported appearance theme/,
  );
});

test("accessibility preferences are first-class persisted definitions", () => {
  const definitions = new Map(
    listPreferenceDefinitions().map((definition) => [definition.id, definition]),
  );
  assert.equal(definitions.get("appearance.theme")?.sectionId, "appearance");
  assert.equal(definitions.get("memory.auto-capture")?.sectionId, "memory");
  assert.equal(definitions.get("accessibility.contrast")?.sectionId, "accessibility");
  assert.equal(definitions.get("accessibility.motion")?.sectionId, "accessibility");
  assert.equal(definitions.get("accessibility.text-scale")?.sectionId, "accessibility");
  assert.equal(definitions.get("regional.locale")?.sectionId, "regional");
  assert.equal(definitions.get("regional.time-zone")?.sectionId, "regional");

  assert.deepEqual(
    createPreferenceSnapshot({
      "accessibility.contrast": "high",
      "accessibility.motion": "reduced",
      "accessibility.text-scale": "extra-large",
    }),
    expectedPreferences({
      "accessibility.contrast": "high",
      "accessibility.motion": "reduced",
      "accessibility.text-scale": "extra-large",
    }),
  );
});

test("invalid accessibility values recover or reject through the shared catalog", () => {
  assert.deepEqual(
    recoverPreferenceSnapshot({
      "accessibility.contrast": "impossible",
      "accessibility.motion": "unknown",
      "accessibility.text-scale": "huge",
    }),
    expectedPreferences(),
  );
  assert.throws(
    () => createPreferenceSnapshot({ "accessibility.motion": "unknown" }),
    /Unsupported accessibility\.motion/,
  );
  assert.throws(
    () => createPreferenceSnapshot({ "accessibility.text-scale": "huge" }),
    /Unsupported accessibility\.text-scale/,
  );
});

test("regional preferences share the first-run supported values", () => {
  assert.deepEqual(
    createPreferenceSnapshot({
      "regional.locale": "pt-BR",
      "regional.time-zone": "America/Sao_Paulo",
    }),
    expectedPreferences({ "regional.time-zone": "America/Sao_Paulo" }),
  );
  assert.equal(
    createPreferenceSnapshot({ "regional.locale": "en-US" })["regional.locale"],
    "en-US",
  );
  assert.equal(
    createPreferenceSnapshot({ "regional.locale": "es-ES" })["regional.locale"],
    "es-ES",
  );
  assert.equal(
    createPreferenceSnapshot({ "regional.locale": "de-DE" })["regional.locale"],
    "de-DE",
  );
  assert.equal(
    createPreferenceSnapshot({ "regional.locale": "fr-FR" })["regional.locale"],
    "fr-FR",
  );
  assert.throws(
    () => createPreferenceSnapshot({ "regional.locale": "it-IT" }),
    /Unsupported regional\.locale/,
  );
  assert.throws(
    () => createPreferenceSnapshot({ "regional.time-zone": "Europe\/London" }),
    /Unsupported regional\.time-zone/,
  );
});


test("regional time-zone resolution has one canonical default and validates explicit state", () => {
  assert.equal(resolveRegionalTimeZone({}), "America/Bahia");
  assert.equal(
    resolveRegionalTimeZone({ "regional.time-zone": "America/Manaus" }),
    "America/Manaus",
  );
  assert.throws(
    () => resolveRegionalTimeZone({ "regional.time-zone": "Europe/London" }),
    /Unsupported regional\.time-zone/,
  );
  assert.throws(
    () => resolveRegionalTimeZone(null),
    /snapshot must be an object/,
  );
});

test("memory automatic capture preference persists through the shared store", () => {
  const snapshot = createPreferenceSnapshot({ "memory.auto-capture": "off" });
  assert.equal(snapshot["memory.auto-capture"], "off");
  assert.equal(
    recoverPreferenceSnapshot({ "memory.auto-capture": "invalid" })["memory.auto-capture"],
    "on",
  );
});
