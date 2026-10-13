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

for (const locale of SURFACE_COMPLETE_LOCALES) {
  test(`desktop shell renders usable launch destinations and one profile in ${locale}`, () => {
    const localization = createSurfaceLocalization(preferenceRuntime(locale));
    try {
      const markup = createDesktopShellMarkup(localization);
      const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
      const launchers = buttons.filter(([, attributes]) =>
        attributes.includes('class="ordax-sidebar-launcher-brand"'),
      );
      assert.equal(launchers.length, 1, "One sidebar brand opens the canonical launcher");
      const [, launcher] = launchers[0];
      assert.ok(launcher.includes('data-launcher-toggle'));
      assert.ok(launcher.includes('aria-controls="ordax-launcher"'));
      assert.ok(launcher.includes('aria-expanded="false"'));
      assert.ok(launcher.includes(`aria-label="${localization.translate("shell.launcher.command")}"`));
      assert.ok(markup.includes('id="ordax-launcher"'));
      assert.ok(markup.includes('data-launcher-query'));
      const navigation = buttons.filter(([, attributes]) =>
        attributes.includes('class="ordax-rail-button"') &&
        attributes.includes('data-launch-app='),
      );
      const expected = ["files", "studio", "internet", "settings", "system"];
      assert.equal(navigation.length, expected.length, "Every pinned destination has one launch control");
      assert.ok(!buttons.some(([, attributes]) => attributes.includes('data-launch-app="assistant"')), "Assistant remains unavailable during the remove-first migration gate");
      for (const id of expected) {
        const matches = navigation.filter(([, attributes]) => attributes.includes(`data-launch-app="${id}"`));
        assert.equal(matches.length, 1, `One sidebar launcher for ${id}`);
        const [, attributes, content] = matches[0];
        const title = localization.translate(`app.${id}.title`);
        assert.ok(attributes.includes(`data-sidebar-app="${id}"`));
        assert.ok(attributes.includes(`title="${title}"`));
        assert.ok(attributes.includes(`aria-label="${localization.translate("surface.launcher.open", { app: title })}"`));
        assert.ok(content.includes(`<span>${title}</span>`));
        assert.ok(content.includes('<svg'), "The collapsed rail retains a visible icon");
      }
      const account = buttons.filter(([, attributes]) => attributes.includes('data-launch-app="account"'));
      assert.equal(account.length, 1, "Account has a single profile launcher, outside pinned app navigation");
      const [, profile] = account[0];
      assert.ok(profile.includes('data-sidebar-account-open'));
      assert.ok(profile.includes('data-app-target="overview"'));
      assert.ok(profile.includes(`aria-label="${localization.translate("sidebar.account.open")}"`));
      assert.ok(!navigation.some(([, attributes]) => attributes.includes('data-launch-app="account"')));
    } finally {
      localization.dispose();
    }
  });
}

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

test("thin Web boot catalog remains identical to the full localization owner", async () => {
  const { SURFACE_BOOT_SOURCE_MESSAGES, SURFACE_BOOT_ENGLISH_MESSAGES } =
    await import("../system/services/i18n/catalog/boot.mjs");
  const { translateSurfaceMessage } = await import("../system/services/i18n/surface.mjs");
  assert.deepEqual(Object.keys(SURFACE_BOOT_SOURCE_MESSAGES), Object.keys(SURFACE_BOOT_ENGLISH_MESSAGES));
  assert.ok(Object.isFrozen(SURFACE_BOOT_SOURCE_MESSAGES));
  for (const [id, message] of Object.entries(SURFACE_BOOT_SOURCE_MESSAGES)) {
    assert.equal(translateSurfaceMessage("pt-BR", id), message);
    assert.equal(translateSurfaceMessage("en-US", id), SURFACE_BOOT_ENGLISH_MESSAGES[id]);
    assert.equal(translateSurfaceMessage("es-ES", id), message, "Existing source-locale fallback is preserved");
  }
  const main = await readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8");
  assert.ok(main.includes("services/i18n/catalog/boot.mjs"));
  assert.ok(!main.includes("services/i18n/surface.mjs"), "Boot cannot eagerly import every application catalog");
  const bootSource = await readFile(new URL("../system/services/i18n/catalog/boot.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(bootSource, /^import\s/m, "Boot catalog is data only");
});
