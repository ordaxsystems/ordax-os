import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  COMPONENT_LOCALIZATION_SCHEMA,
  LOCALIZATION_PACK_RELEASE_SCHEMA,
  defineComponentLocalization,
  defineLocalizationPackRelease,
  localizationPackReleaseMatchesComponent,
} from "../system/contracts/localization-pack.mjs";
import {
  availableComponentLocales,
  resolveComponentLocaleSelection,
} from "../system/services/i18n/component-locale.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function chineseReadyManifest(overrides = {}) {
  return defineComponentLocalization({
    targetId: "notes",
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    optionalLocales: ["zh-Hans"],
    allowAppOverride: true,
    packPolicy: "component-scoped",
    ...overrides,
  });
}

test("first-party apps expose one validated component-localization contract", () => {
  const apps = listFirstPartyApps();
  assert.ok(apps.length >= 10);
  for (const app of apps) {
    assert.equal(app.localization.schema, COMPONENT_LOCALIZATION_SCHEMA, app.id);
    assert.equal(app.localization.targetId, app.id, app.id);
    assert.equal(app.localization.sourceLocale, "pt-BR", app.id);
    assert.equal(app.localization.packPolicy, "component-scoped", app.id);
    assert.equal(app.localization.allowAppOverride, true, app.id);
    assert.deepEqual(app.localization.optionalLocales, [], app.id);
    assert.equal(Object.isFrozen(app.localization), true, app.id);
    assert.equal(Object.isFrozen(app.localization.bundledLocales), true, app.id);
    assert.equal(Object.isFrozen(app.localization.optionalLocales), true, app.id);
  }
});

test("an installed optional locale remains scoped to its declaring app", () => {
  const manifest = chineseReadyManifest();
  assert.deepEqual(
    availableComponentLocales(manifest, ["zh-Hans"]),
    ["pt-BR", "en-US", "zh-Hans"],
  );
  assert.deepEqual(
    availableComponentLocales(manifest, ["ja-JP"]),
    ["pt-BR", "en-US"],
  );

  const resolved = resolveComponentLocaleSelection({
    manifest,
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: ["zh-Hans"],
  });
  assert.equal(resolved.locale, "zh-Hans");
  assert.equal(resolved.source, "app-override");
  assert.equal(resolved.degraded, false);
});

test("removed app override falls back to system locale before source locale", () => {
  const resolved = resolveComponentLocaleSelection({
    manifest: chineseReadyManifest(),
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: [],
  });
  assert.equal(resolved.locale, "en-US");
  assert.equal(resolved.source, "system-fallback-after-unavailable-app-override");
  assert.equal(resolved.degraded, true);
});

test("unsupported system locale falls back as one whole catalog to source", () => {
  const resolved = resolveComponentLocaleSelection({
    manifest: chineseReadyManifest(),
    systemLocale: "ja-JP",
  });
  assert.equal(resolved.locale, "pt-BR");
  assert.equal(resolved.source, "source-fallback");
  assert.equal(resolved.degraded, true);
});

test("component policy can disable per-app override without changing system fallback", () => {
  const resolved = resolveComponentLocaleSelection({
    manifest: chineseReadyManifest({ allowAppOverride: false }),
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: ["zh-Hans"],
  });
  assert.equal(resolved.locale, "en-US");
  assert.equal(resolved.source, "system");
  assert.equal(resolved.degraded, false);
});

test("signed release descriptor is authority-free and binds exact component contract", () => {
  const manifest = chineseReadyManifest();
  const release = defineLocalizationPackRelease({
    targetKind: "app",
    targetId: "notes",
    componentVersion: "20.4.0",
    locale: "zh-Hans",
    packVersion: "1.0.1",
    messageContractSha256: HASH_A,
    contentSha256: HASH_B,
    size: 4096,
    publisher: "OrdaX",
    signature: "test-signature",
  });

  assert.equal(release.schema, LOCALIZATION_PACK_RELEASE_SCHEMA);
  assert.equal(
    localizationPackReleaseMatchesComponent(release, manifest, {
      componentVersion: "20.4.0",
      messageContractSha256: HASH_A,
    }),
    true,
  );
  assert.equal(
    localizationPackReleaseMatchesComponent(release, manifest, {
      componentVersion: "20.5.0",
      messageContractSha256: HASH_A,
    }),
    false,
  );
  assert.equal(
    localizationPackReleaseMatchesComponent(release, manifest, {
      componentVersion: "20.4.0",
      messageContractSha256: HASH_B,
    }),
    false,
  );

  assert.throws(
    () => defineLocalizationPackRelease({
      ...release,
      permissions: ["filesystem.user-space"],
    }),
    /cannot declare permissions/,
  );
  assert.throws(
    () => defineLocalizationPackRelease({
      ...release,
      entrypoint: "payload.mjs",
    }),
    /cannot declare entrypoint/,
  );
});

test("bundled-only components cannot advertise installable optional locales", () => {
  assert.throws(
    () => chineseReadyManifest({ packPolicy: "bundled-only" }),
    /cannot declare optional locales/,
  );
});
