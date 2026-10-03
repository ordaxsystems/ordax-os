import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";
import { FIRST_RUN_PUBLIC_MVP_LOCALES } from "../system/contracts/first-run-state-store.mjs";
import { createDesktopShellMarkup } from "../system/surface/ui/desktop-shell.mjs";
import { syncSurfaceDocumentLocale } from "../system/surface/ui/surface.mjs";
import {
  SURFACE_COMPLETE_LOCALES,
  SURFACE_SOURCE_LOCALE,
  surfaceMessageIds,
  translateSurfaceMessage,
} from "../system/services/i18n/surface.mjs";
import { describeLocale } from "../system/services/i18n/locale-profile.mjs";
import {
  LOCALIZATION_QA_PSEUDO_LOCALES,
  pseudoLocalize,
} from "../system/services/i18n/qa.mjs";

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map(match => match[1])
    .sort();
}

function sourcePort() {
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return SURFACE_SOURCE_LOCALE;
    },
    translate(messageId, values = {}) {
      return translateSurfaceMessage(SURFACE_SOURCE_LOCALE, messageId, values);
    },
    subscribe(listener) {
      listener(SURFACE_SOURCE_LOCALE);
      return () => {};
    },
  });
}

function pseudoPort(locale) {
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return locale;
    },
    translate(messageId, values = {}) {
      const pseudo = pseudoLocalize(
        translateSurfaceMessage(SURFACE_SOURCE_LOCALE, messageId),
        locale,
      );
      return pseudo.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) => (
        values[key] === undefined || values[key] === null ? match : String(values[key])
      ));
    },
    subscribe(listener) {
      listener(locale);
      return () => {};
    },
  });
}

function fakeDocumentElement() {
  const attributes = new Map();
  return {
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

test("locale profiles derive text direction from canonical BCP 47 script metadata", () => {
  assert.deepEqual(describeLocale("pt-br"), {
    locale: "pt-BR",
    language: "pt",
    script: "Latn",
    region: "BR",
    direction: "ltr",
  });
  assert.equal(describeLocale("ar-XB").direction, "rtl");
  assert.equal(describeLocale("he-IL").direction, "rtl");
  assert.equal(describeLocale("fa-IR").direction, "rtl");
  assert.equal(describeLocale("en-XA").direction, "ltr");
  assert.throws(() => describeLocale("not_a_locale"), /Invalid BCP 47 locale/);
});

test("QA pseudo-locales stay engineering-only and cannot become public locales by accident", () => {
  assert.deepEqual(Object.keys(LOCALIZATION_QA_PSEUDO_LOCALES), ["en-XA", "ar-XB"]);
  for (const locale of Object.keys(LOCALIZATION_QA_PSEUDO_LOCALES)) {
    assert.equal(FIRST_RUN_PUBLIC_MVP_LOCALES.includes(locale), false);
    assert.equal(SURFACE_COMPLETE_LOCALES.includes(locale), false);
  }
});

test("pseudo-localization expands every Surface message while preserving placeholders exactly", () => {
  for (const messageId of surfaceMessageIds()) {
    const source = translateSurfaceMessage(SURFACE_SOURCE_LOCALE, messageId);
    for (const locale of Object.keys(LOCALIZATION_QA_PSEUDO_LOCALES)) {
      const pseudo = pseudoLocalize(source, locale);
      assert.deepEqual(
        placeholders(pseudo),
        placeholders(source),
        `placeholder drift in ${locale} for ${messageId}`,
      );
      assert.ok(
        pseudo.length > source.length,
        `pseudo-locale did not expand ${messageId} for ${locale}`,
      );
    }
  }
});

test("expanded pseudo-locale renders a larger representative desktop shell without raw message ids", () => {
  const sourceMarkup = createDesktopShellMarkup(sourcePort());
  const pseudoMarkup = createDesktopShellMarkup(pseudoPort("en-XA"));
  assert.match(pseudoMarkup, /⟦/);
  assert.doesNotMatch(pseudoMarkup, /shell\.[a-zA-Z0-9.-]+/);
  assert.ok(pseudoMarkup.length > sourceMarkup.length);
});

test("RTL pseudo-locale drives document lang and dir through the same Surface locale path", () => {
  const element = fakeDocumentElement();
  const profile = syncSurfaceDocumentLocale(element, pseudoPort("ar-XB"));
  assert.equal(profile.locale, "ar-XB");
  assert.equal(profile.direction, "rtl");
  assert.equal(element.getAttribute("lang"), "ar-XB");
  assert.equal(element.getAttribute("dir"), "rtl");

  const markup = createDesktopShellMarkup(pseudoPort("ar-XB"));
  assert.match(markup, /\u2067/);
  assert.doesNotMatch(markup, /shell\.[a-zA-Z0-9.-]+/);
});

test("machine-readable localization policy declares pseudo-locale and RTL QA invariants", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../docs/contracts/localization-pack.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(contract.qa?.pseudo_locales, ["en-XA", "ar-XB"]);
  assert.equal(contract.qa?.publicly_selectable, false);
  assert.equal(contract.qa?.distributable_as_language_pack, false);
  assert.equal(contract.qa?.placeholder_preservation_required, true);
  assert.equal(contract.qa?.expanded_layout_gate_required, true);
  assert.equal(contract.qa?.rtl_direction_gate_required, true);
});
