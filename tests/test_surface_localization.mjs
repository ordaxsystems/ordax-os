import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { createDesktopShellMarkup } from "../system/surface/ui/desktop-shell.mjs";
import {
  SURFACE_COMPLETE_LOCALES,
  SURFACE_ENGLISH_TARGET_LOCALE,
  SURFACE_SOURCE_LOCALE,
  createSurfaceLocalization,
  surfaceCatalogCoverage,
} from "../system/services/i18n/surface.mjs";

function preferenceRuntime(initialLocale = "pt-BR") {
  let snapshot = Object.freeze({
    "appearance.theme": "system",
    "accessibility.contrast": "standard",
    "accessibility.motion": "full",
    "accessibility.text-scale": "standard",
    "regional.locale": initialLocale,
    "regional.time-zone": "America/Bahia",
  });
  const listeners = new Set();
  return Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    set(preferenceId, value, { notify = true } = {}) {
      snapshot = Object.freeze({ ...snapshot, [preferenceId]: value });
      if (notify) {
        for (const listener of [...listeners]) listener(snapshot);
      }
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  });
}

test("Surface localization reads the live regional locale synchronously", () => {
  const preferences = preferenceRuntime();
  const localization = createSurfaceLocalization(preferences);

  assert.equal(localization.getLocale(), "pt-BR");
  assert.deepEqual(localization.getProfile(), {
    schema: "ordax.locale-profile/1",
    locale: "pt-BR",
    language: "pt",
    script: "Latn",
    region: "BR",
    direction: "ltr",
  });
  assert.equal(localization.translate("app.files.title"), "Arquivos");

  preferences.set("regional.locale", "en-US", { notify: false });
  assert.equal(localization.getLocale(), "en-US");
  assert.equal(localization.getProfile().direction, "ltr");
  assert.equal(localization.translate("app.files.title"), "Files");
  assert.equal(
    localization.translate("surface.window.close", { app: "Files" }),
    "Close Files",
  );

  localization.dispose();
});

test("localization subscribers observe preference changes without owning another locale state", () => {
  const preferences = preferenceRuntime();
  const localization = createSurfaceLocalization(preferences);
  const observed = [];
  const unsubscribe = localization.subscribe((locale) => observed.push(locale));

  preferences.set("regional.locale", "en-US");
  preferences.set("regional.locale", "en-US");
  preferences.set("regional.locale", "es-ES");

  assert.deepEqual(observed, ["pt-BR", "en-US", "es-ES"]);
  assert.equal(localization.getLocale(), "es-ES");
  assert.equal(
    localization.translate("surface.launcher.empty"),
    "Nenhum aplicativo encontrado.",
  );

  unsubscribe();
  localization.dispose();
});

test("catalog coverage marks only launch-complete Surface locales", () => {
  assert.equal(SURFACE_SOURCE_LOCALE, "pt-BR");
  assert.equal(SURFACE_ENGLISH_TARGET_LOCALE, "en-US");
  assert.deepEqual(SURFACE_COMPLETE_LOCALES, ["pt-BR", "en-US"]);
  assert.equal(surfaceCatalogCoverage("pt-BR").complete, true);
  assert.equal(surfaceCatalogCoverage("en-US").complete, true);
  for (const locale of SURFACE_COMPLETE_LOCALES) assert.equal(surfaceCatalogCoverage(locale).complete, true);
  assert.equal(surfaceCatalogCoverage("es-ES").complete, false);
});

test("desktop shell is born in English when regional locale is English", () => {
  const localization = createSurfaceLocalization(preferenceRuntime("en-US"));
  const markup = createDesktopShellMarkup(localization);
  assert.match(markup, /aria-label="Main applications"/);
  assert.match(markup, />Files</);
  assert.match(markup, />Your space</);
  assert.match(markup, /placeholder="Search applications"/);
  assert.match(markup, />Area 01</);
  assert.match(markup, />Connectivity unknown</);
  assert.doesNotMatch(
    markup,
    /Aplicativos principais|>Arquivos<|>Seu espaço|Conectividade desconhecida/,
  );
  localization.dispose();
});

test("unknown Surface message ids fail closed", () => {
  const localization = createSurfaceLocalization(preferenceRuntime("en-US"));
  assert.throws(
    () => localization.translate("surface.missing.message"),
    /Unknown Surface localization message/,
  );
  localization.dispose();
});

test("Surface translation uses the canonical interpolation boundary without legacy coercion", async () => {
  const localization = createSurfaceLocalization(preferenceRuntime("en-US"));
  assert.equal(
    localization.translate("home.pending.notifications.title.many", { count: 2 }),
    "2 unread notifications",
  );
  assert.equal(
    localization.translate("surface.window.close", { app: " Files " }),
    "Close  Files ",
  );
  assert.equal(
    localization.translate("surface.window.close"),
    "Close {app}",
  );
  for (const app of [true, { name: "Files" }, [], Number.NaN, Infinity, 5n]) {
    assert.throws(
      () => localization.translate("surface.window.close", { app }),
      /must be text or a finite number/,
    );
  }
  const inherited = Object.create({ app: "unsafe" });
  assert.equal(localization.translate("surface.window.close", inherited), "Close {app}");
  localization.dispose();

  const owner = await readFile(
    new URL("../system/services/i18n/surface.mjs", import.meta.url),
    "utf8",
  );
  assert.match(owner, /import \{ interpolateLocalizationMessage \} from "\.\/interpolation\.mjs";/);
  assert.match(owner, /return interpolateLocalizationMessage\(translated, values\);/);
  assert.doesNotMatch(owner, /function interpolate\s*\(/);
  assert.doesNotMatch(owner, /String\(value\)/);
});

test("shared Surface is wired to localization instead of hardcoded locale rendering", async () => {
  const surface = await readFile(
    new URL("../system/surface/ui/surface.mjs", import.meta.url),
    "utf8",
  );
  const shell = await readFile(
    new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url),
    "utf8",
  );

  assert.match(surface, /createSurfaceLocalization\(preferences\)/);
  assert.match(surface, /createDesktopShellMarkup\(localization\)/);
  assert.match(surface, /localization,/);
  assert.match(surface, /syncDocumentLocaleProfile\(documentElement, localization\)/);
  assert.match(surface, /syncDesktopShellLocalization\(root, localization\)/);
  assert.doesNotMatch(surface, /toLocaleLowerCase\("pt-BR"\)/);
  assert.match(shell, /syncDesktopShellLocalization/);
  assert.match(shell, /shell\.launcher\.search/);
  assert.match(shell, /surface\.launcher\.open/);
});
