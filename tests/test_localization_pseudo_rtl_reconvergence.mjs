import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createLocaleProfile, localeDirection } from "../system/contracts/locale-profile.mjs";
import {
  PSEUDO_LOCALES,
  pseudoLocalizeText,
} from "../tools/localization/pseudo-localization.mjs";

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function placeholders(value) {
  return [...String(value).matchAll(PLACEHOLDER)].map(match => match[1]);
}

test("locale profile canonicalizes ids and exposes complete script/direction metadata", () => {
  assert.deepEqual(createLocaleProfile("PT-br"), {
    schema: "ordax.locale-profile/1",
    locale: "pt-BR",
    language: "pt",
    script: "Latn",
    region: "BR",
    direction: "ltr",
  });
  assert.equal(localeDirection("ar-XB"), "rtl");
  assert.equal(localeDirection("he-IL"), "rtl");
  assert.equal(localeDirection("az-Arab-AZ"), "rtl");
  assert.equal(localeDirection("az-Latn-AZ"), "ltr");
  assert.equal(localeDirection("en-XA"), "ltr");
});

test("pseudo-localization expands visible copy and preserves interpolation placeholders exactly", () => {
  const source = "Close {app} in {area}";
  const transformed = pseudoLocalizeText(source, "expanded");
  assert.match(transformed, /^⟦/);
  assert.match(transformed, /⟧$/);
  assert.deepEqual(placeholders(transformed), placeholders(source));
  assert.ok(transformed.length >= Math.ceil(source.length * 1.3));
});

test("RTL pseudo-localization is isolated and preserves placeholder identity", () => {
  const source = "Open {app}";
  const transformed = pseudoLocalizeText(source, "rtl");
  assert.equal(transformed.startsWith("\u2067⟦"), true);
  assert.equal(transformed.endsWith("⟧\u2069"), true);
  assert.deepEqual(placeholders(transformed), placeholders(source));
  assert.equal(PSEUDO_LOCALES.rtl.locale, "ar-XB");
  assert.equal(PSEUDO_LOCALES.rtl.direction, "rtl");
});

test("machine-readable localization contract keeps pseudo-locales engineering-only", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../docs/contracts/localization.json", import.meta.url),
    "utf8",
  ));

  assert.equal(contract.$schema, "prototype-ordax.localization/2");
  assert.equal(contract.runtime_schema, "ordax.localization/2");
  assert.equal(contract.locale_profile_schema, "ordax.locale-profile/1");
  assert.deepEqual(contract.public_complete_locales, ["pt-BR", "en-US"]);
  assert.equal(contract.pseudo_locales.publicly_selectable, false);
  assert.equal(contract.pseudo_locales.persistable_as_user_preference, false);
  assert.equal(contract.pseudo_locales.release_catalog_locale, false);
  assert.equal(contract.pseudo_locales.expanded.locale, "en-XA");
  assert.equal(contract.pseudo_locales.rtl.locale, "ar-XB");
  assert.equal(contract.pseudo_locales.placeholder_identity_must_be_preserved, true);
});
