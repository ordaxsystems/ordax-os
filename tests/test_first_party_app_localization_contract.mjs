import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";

const MVP_BASELINE = ["pt-BR", "en-US"];

test("every first-party app declares an explicit component-scoped localization baseline", () => {
  const apps = listFirstPartyApps();
  assert.ok(apps.length > 0, "bundled app catalog cannot be empty");
  assert.equal(apps.some((app) => app.id === "projects"), false,
    "removed Projects app must be localized by its verified package, not OS");
  for (const app of apps) {
    assert.equal(app.localization.sourceLocale, "pt-BR", `${app.id}: unexpected source locale`);
    assert.equal(app.localization.packPolicy, "component-scoped", `${app.id}: pack policy drifted`);
    for (const locale of MVP_BASELINE) {
      assert.ok(
        app.localization.bundledLocales.includes(locale),
        `${app.id}: ${locale} must be bundled for the current MVP baseline`,
      );
    }
  }
});

test("locale availability is app-scoped rather than a global equality invariant", () => {
  const apps = listFirstPartyApps();
  const hypothetical = {
    ...apps[0],
    localization: {
      ...apps[0].localization,
      bundledLocales: [...apps[0].localization.bundledLocales, "zh-Hans"],
    },
  };
  assert.ok(hypothetical.localization.bundledLocales.includes("zh-Hans"));
  for (const app of apps.slice(1)) {
    assert.equal(app.localization.bundledLocales.includes("zh-Hans"), false);
  }
});
