import { homeShortcutsPreference, HOME_SHORTCUTS_PREFERENCE_ID } from '../system/services/preferences/home-shortcuts.mjs';
import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferenceSnapshot,
  listPreferenceDefinitions,
  recoverPreferenceSnapshot,
} from "../system/services/preferences/catalog.mjs";
import { resolveRegionalTimeZone } from "../system/services/preferences/regional.mjs";
import { createWebPreferenceStore } from "../system/adapters/web/preferences.mjs";
import { MAX_PREFERENCE_ENTRIES, MAX_PREFERENCE_STRING_LENGTH, validatePreferenceRecord } from "../system/contracts/preference-store.mjs";

const REGIONAL_DEFAULTS = Object.freeze({
  "regional.locale": "pt-BR",
  "regional.time-zone": "America/Bahia",
});

function expectedPreferences(values = {}) {
  return {
    "appearance.theme": "light",
    "surface.color-palette": "standard",
    "memory.auto-capture": "on",
    [HOME_SHORTCUTS_PREFERENCE_ID]: homeShortcutsPreference.defaultValue,
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

test("bounded preference records share finite number, key and Unicode text semantics across hosts", () => {
  const valid = { "test.null": null, "test.bool": true, "test.number": -0.5, "test.string": "abc" };
  assert.deepEqual(validatePreferenceRecord(valid), valid);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => validatePreferenceRecord({ "test.number": value }), /scalar/);
  }
  assert.equal(validatePreferenceRecord({ "test.text": "x".repeat(MAX_PREFERENCE_STRING_LENGTH) })["test.text"].length, 4096);
  assert.throws(() => validatePreferenceRecord({ "test.text": "x".repeat(MAX_PREFERENCE_STRING_LENGTH + 1) }), /scalar/);
  assert.doesNotThrow(() => validatePreferenceRecord({ "test.emoji": "😀".repeat(MAX_PREFERENCE_STRING_LENGTH) }));
  assert.throws(() => validatePreferenceRecord({ "test.emoji": "😀".repeat(MAX_PREFERENCE_STRING_LENGTH + 1) }), /scalar/);
  const full = Object.fromEntries(Array.from({ length: MAX_PREFERENCE_ENTRIES }, (_, i) => [`key.${i}`, i]));
  assert.equal(Object.keys(validatePreferenceRecord(full)).length, MAX_PREFERENCE_ENTRIES);
  assert.throws(() => validatePreferenceRecord({ ...full, "key.extra": 1 }), /entry limit/);
});

test("Web store refuses invalid Native preference shapes without corrupting last good record", () => {
  const storage = new FakeStorage();
  const store = createWebPreferenceStore({ localStorage: storage });
  assert.equal(store.save({ "appearance.theme": "dark" }), true);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => store.save({ "test.number": value }), TypeError);
  }
  assert.throws(() => store.save({ "test.text": "a".repeat(MAX_PREFERENCE_STRING_LENGTH + 1) }), TypeError);
  assert.deepEqual(store.load(), { "appearance.theme": "dark" });
});
