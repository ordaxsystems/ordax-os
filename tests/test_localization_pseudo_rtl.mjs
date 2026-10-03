import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { createSurfaceLocalization } from "../system/services/i18n/surface.mjs";
import { createLocaleProfile, localeDirection } from "../system/services/i18n/locale-profile.mjs";
import { createDesktopShellMarkup } from "../system/surface/ui/desktop-shell.mjs";
import { syncDocumentLocaleProfile } from "../system/surface/ui/document-localization.mjs";
import {
  PSEUDO_LOCALES,
  createPseudoLocalization,
  pseudoLocalizeText,
} from "../tools/localization/pseudo-localization.mjs";

function preferenceRuntime(initialLocale = "pt-BR") {
  let snapshot = Object.freeze({
    "regional.locale": initialLocale,
    "regional.time-zone": "America/Bahia",
  });
  const listeners = new Set();
  return Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    set(preferenceId, value) {
      snapshot = Object.freeze({ ...snapshot, [preferenceId]: value });
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  });
}

test("locale profile normalizes ids and derives direction from script before language defaults", () => {
  assert.deepEqual(
    createLocaleProfile("PT-br"),
    { schema: "ordax.locale-profile/1", locale: "pt-BR", direction: "ltr" },
  );
  assert.equal(localeDirection("ar-XB"), "rtl");
  assert.equal(localeDirection("he-IL"), "rtl");
  assert.equal(localeDirection("az-Arab-AZ"), "rtl");
  assert.equal(localeDirection("az-Latn-AZ"), "ltr");
  assert.equal(localeDirection("en-XA"), "ltr");
});

test("pseudo-localization expands copy without corrupting interpolation placeholders", () => {
  const source = "Close {app} in {area}";
  const transformed = pseudoLocalizeText(source, "expanded");
  assert.match(transformed, /^\[!! /);
  assert.equal((transformed.match(/\{app\}/g) ?? []).length, 1);
  assert.equal((transformed.match(/\{area\}/g) ?? []).length, 1);
  assert.ok(transformed.length >= Math.ceil(source.length * 1.3));
});

test("expanded pseudo-locale exercises the real Surface localization contract without becoming public", () => {
  const base = createSurfaceLocalization(preferenceRuntime("pt-BR"));
  const pseudo = createPseudoLocalization(base, "expanded");
  assert.equal(pseudo.getLocale(), PSEUDO_LOCALES.expanded.locale);
  assert.equal(pseudo.getProfile().direction, "ltr");

  const markup = createDesktopShellMarkup(pseudo);
  assert.match(markup, /\[!!/);
  assert.doesNotMatch(markup, />Arquivos</);
  assert.doesNotMatch(markup, /Aplicativos principais/);

  base.dispose();
});

test("RTL pseudo-locale drives document direction through the production sync boundary", () => {
  const base = createSurfaceLocalization(preferenceRuntime("pt-BR"));
  const pseudo = createPseudoLocalization(base, "rtl");
  const documentElement = {};

  const profile = syncDocumentLocaleProfile(documentElement, pseudo);
  assert.equal(profile.locale, PSEUDO_LOCALES.rtl.locale);
  assert.equal(profile.direction, "rtl");
  assert.equal(documentElement.lang, "ar-XB");
  assert.equal(documentElement.dir, "rtl");

  const markup = createDesktopShellMarkup(pseudo);
  assert.match(markup, /⟦/);
  assert.doesNotMatch(markup, /Aplicativos principais/);

  base.dispose();
});

test("normal public Surface locales remain LTR and unchanged by pseudo-locale tooling", () => {
  const base = createSurfaceLocalization(preferenceRuntime("en-US"));
  const documentElement = {};
  const profile = syncDocumentLocaleProfile(documentElement, base);

  assert.equal(profile.locale, "en-US");
  assert.equal(profile.direction, "ltr");
  assert.equal(documentElement.lang, "en-US");
  assert.equal(documentElement.dir, "ltr");
  assert.match(createDesktopShellMarkup(base), /Main applications/);

  base.dispose();
});

test("machine-readable localization contract keeps pseudo-locales outside public product support", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../docs/contracts/localization.json", import.meta.url),
    "utf8",
  ));

  assert.equal(contract.$schema, "prototype-ordax.localization/2");
  assert.equal(contract.runtime_schema, "ordax.localization/2");
  assert.deepEqual(contract.public_complete_locales, ["pt-BR", "en-US"]);
  assert.equal(contract.pseudo_locales.publicly_selectable, false);
  assert.equal(contract.pseudo_locales.persistable_as_user_preference, false);
  assert.equal(contract.pseudo_locales.expanded.locale, "en-XA");
  assert.equal(contract.pseudo_locales.rtl.locale, "ar-XB");
  assert.equal(contract.pseudo_locales.placeholder_identity_must_be_preserved, true);
});
