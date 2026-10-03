import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  COMPONENT_LOCALIZATION_SCHEMA,
  LOCALIZATION_PACK_SCHEMA,
  defineComponentLocalization,
  defineLocalizationPack,
  localizationPackMatchesComponent,
} from "../system/contracts/localization-pack.mjs";
import {
  availableComponentLocales,
  resolveComponentLocale,
} from "../system/services/i18n/component-locale.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function chineseReadyManifest() {
  return defineComponentLocalization({
    targetId: "example-app",
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    optionalLocales: ["zh-Hans"],
    allowAppOverride: true,
  });
}

test("every first-party app declares an explicit localization contract", () => {
  const apps = listFirstPartyApps();
  assert.ok(apps.length > 0);
  for (const app of apps) {
    assert.equal(app.localization.schema, COMPONENT_LOCALIZATION_SCHEMA, app.id);
    assert.equal(app.localization.targetId, app.id, app.id);
    assert.equal(app.localization.sourceLocale, "pt-BR", app.id);
    assert.deepEqual(app.localization.bundledLocales, ["pt-BR", "en-US"], app.id);
    assert.equal(app.localization.allowAppOverride, true, app.id);
  }
});

test("an app may expose an installed language that the Surface does not expose", () => {
  const manifest = chineseReadyManifest();
  assert.deepEqual(
    availableComponentLocales(manifest, ["zh-Hans"]),
    ["pt-BR", "en-US", "zh-Hans"],
  );
  const resolved = resolveComponentLocale({
    manifest,
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: ["zh-Hans"],
  });
  assert.equal(resolved.locale, "zh-Hans");
  assert.equal(resolved.source, "app-override");
  assert.equal(resolved.degraded, false);
});

test("a stale app override falls back to the system locale before the source locale", () => {
  const resolved = resolveComponentLocale({
    manifest: chineseReadyManifest(),
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: [],
  });
  assert.equal(resolved.locale, "en-US");
  assert.equal(resolved.source, "system-fallback-after-unavailable-app-override");
  assert.equal(resolved.degraded, true);
});

test("unsupported system locale falls back deterministically to the source locale", () => {
  const resolved = resolveComponentLocale({
    manifest: chineseReadyManifest(),
    systemLocale: "ja-JP",
    installedOptionalLocales: [],
  });
  assert.equal(resolved.locale, "pt-BR");
  assert.equal(resolved.source, "source-fallback");
  assert.equal(resolved.degraded, true);
});

test("language packs are resource-only and bind to a message contract hash", () => {
  const manifest = chineseReadyManifest();
  const pack = defineLocalizationPack({
    targetKind: "app",
    targetId: "example-app",
    locale: "zh-Hans",
    version: "1.0.1",
    messageContractSha256: HASH_A,
    contentSha256: HASH_B,
    size: 4096,
    publisher: "OrdaX",
    signature: "test-signature",
  });
  assert.equal(pack.schema, LOCALIZATION_PACK_SCHEMA);
  assert.equal(localizationPackMatchesComponent(pack, manifest, HASH_A), true);
  assert.equal(localizationPackMatchesComponent(pack, manifest, HASH_B), false);
  assert.throws(
    () => defineLocalizationPack({
      ...pack,
      permissions: ["filesystem.user-space"],
    }),
    /cannot declare permissions/,
  );
});
