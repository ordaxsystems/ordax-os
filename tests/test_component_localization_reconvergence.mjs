import assert from "node:assert/strict";
import test from "node:test";

import {
  defineLocalizationPackDelivery,
  localizationDeliveryMatchesComponent,
} from "../system/contracts/localization-pack-delivery.mjs";
import {
  availableComponentLocales,
  resolveComponentLocale,
} from "../system/services/i18n/component-locale.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const localization = Object.freeze({
  sourceLocale: "pt-BR",
  bundledLocales: Object.freeze(["pt-BR", "en-US"]),
  optionalLocales: Object.freeze(["zh-Hans"]),
  allowAppOverride: true,
  packPolicy: "component-scoped",
});

test("installed optional locale stays component-scoped and may exceed Surface locales", () => {
  assert.deepEqual(
    availableComponentLocales(localization, ["zh-Hans"]),
    ["pt-BR", "en-US", "zh-Hans"],
  );
  const resolved = resolveComponentLocale({
    localization,
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: ["zh-Hans"],
  });
  assert.equal(resolved.locale, "zh-Hans");
  assert.equal(resolved.source, "app-override");
  assert.equal(resolved.degraded, false);
});

test("removed optional override falls back to system locale before source", () => {
  const resolved = resolveComponentLocale({
    localization,
    systemLocale: "en-US",
    appLocale: "zh-Hans",
    installedOptionalLocales: [],
  });
  assert.equal(resolved.locale, "en-US");
  assert.equal(resolved.source, "system-fallback-after-unavailable-app-override");
  assert.equal(resolved.degraded, true);
});

test("unsupported system locale falls back to component source locale", () => {
  const resolved = resolveComponentLocale({
    localization,
    systemLocale: "ja-JP",
    installedOptionalLocales: [],
  });
  assert.equal(resolved.locale, "pt-BR");
  assert.equal(resolved.source, "source-fallback");
  assert.equal(resolved.degraded, true);
});

test("undeclared installed locale never becomes available", () => {
  assert.deepEqual(
    availableComponentLocales(localization, ["de-DE"]),
    ["pt-BR", "en-US"],
  );
});

test("signed delivery envelope carries no executable authority and binds to component contract", () => {
  const delivery = defineLocalizationPackDelivery({
    componentId: "notes",
    componentVersion: "20.4.0",
    packVersion: "3.1.1",
    locale: "zh-Hans",
    messageContractSha256: HASH_A,
    contentSha256: HASH_B,
    size: 4096,
    publisher: "OrdaX",
    signature: "test-signature",
  });
  assert.equal(delivery.schema, "prototype-ordax.localization-pack-delivery/1");
  assert.equal(
    localizationDeliveryMatchesComponent(delivery, localization, {
      componentId: "notes",
      componentVersion: "20.4.0",
      messageContractSha256: HASH_A,
    }),
    true,
  );
  assert.equal(
    localizationDeliveryMatchesComponent(delivery, localization, {
      componentId: "notes",
      componentVersion: "20.4.0",
      messageContractSha256: HASH_B,
    }),
    false,
  );
  assert.throws(
    () => defineLocalizationPackDelivery({
      ...delivery,
      permissions: ["filesystem.user-space"],
    }),
    /cannot declare permissions/,
  );
});
