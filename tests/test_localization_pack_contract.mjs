import assert from "node:assert/strict";
import test from "node:test";

import {
  defineLocalizationPack,
  resolveComponentLocale,
  validateLocalizationParity,
} from "../system/contracts/localization-pack.mjs";

const source = {
  componentId: "notes",
  componentVersion: "20.4.0",
  packVersion: "3.1.0",
  locale: "pt-BR",
  sourceLocale: "pt-BR",
  kind: "bundled",
  messages: {
    "notes.save": "Salvar",
    "notes.savedAs": "Salvo como {name}",
  },
};

const english = {
  componentId: "notes",
  componentVersion: "20.4.0",
  packVersion: "3.1.0",
  locale: "en-US",
  sourceLocale: "pt-BR",
  kind: "bundled",
  messages: {
    "notes.save": "Save",
    "notes.savedAs": "Saved as {name}",
  },
};

test("localization packs are component/version scoped and preserve message contracts", () => {
  const pack = defineLocalizationPack(english);
  assert.equal(pack.schema, "prototype-ordax.localization-pack/1");
  assert.equal(pack.componentId, "notes");
  assert.equal(pack.componentVersion, "20.4.0");
  assert.equal(pack.packVersion, "3.1.0");
  assert.equal(pack.locale, "en-US");
  assert.equal(validateLocalizationParity(source, english), true);
});

test("a translation may not drift message ids", () => {
  assert.throws(
    () => validateLocalizationParity(source, {
      ...english,
      messages: { "notes.save": "Save" },
    }),
    /message ids do not match/,
  );
});

test("a translation may not drift interpolation placeholders", () => {
  assert.throws(
    () => validateLocalizationParity(source, {
      ...english,
      messages: {
        "notes.save": "Save",
        "notes.savedAs": "Saved",
      },
    }),
    /placeholders diverged/,
  );
});

test("packs for another component version are rejected", () => {
  assert.throws(
    () => validateLocalizationParity(source, {
      ...english,
      componentVersion: "20.5.0",
    }),
    /componentVersion mismatch/,
  );
});

test("source locale is never installed as an external pack", () => {
  assert.throws(
    () => defineLocalizationPack({ ...source, kind: "external" }),
    /Source locale must not be installed as an external localization pack/,
  );
});

test("component locale resolution is independent and safely falls back", () => {
  assert.equal(
    resolveComponentLocale({
      requestedLocale: "zh-Hans",
      sourceLocale: "pt-BR",
      availableLocales: ["pt-BR", "en-US", "zh-Hans"],
    }),
    "zh-Hans",
  );
  assert.equal(
    resolveComponentLocale({
      requestedLocale: "zh-Hant",
      sourceLocale: "pt-BR",
      availableLocales: ["pt-BR", "en-US", "zh-Hans"],
    }),
    "zh-Hans",
  );
  assert.equal(
    resolveComponentLocale({
      requestedLocale: "ja-JP",
      sourceLocale: "pt-BR",
      availableLocales: ["pt-BR", "en-US", "zh-Hans"],
    }),
    "pt-BR",
  );
});

test("invalid or ambiguous locale identifiers fail closed", () => {
  assert.throws(
    () => defineLocalizationPack({ ...english, locale: "mandarin" }),
    /Invalid locale/,
  );
});
