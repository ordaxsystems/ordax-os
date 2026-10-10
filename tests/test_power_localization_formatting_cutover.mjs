import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";
import { createLocaleFormatting } from "../system/services/i18n/formatting.mjs";
import { resolveRegionalTimeZone } from "../system/services/preferences/regional.mjs";

function localization(locale) {
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return locale;
    },
    getProfile() {
      return createLocaleProfile(locale);
    },
    translate(messageId) {
      return messageId;
    },
    subscribe() {
      return () => {};
    },
  });
}

test("canonical formatter presents battery percentages and timestamps for explicit regional state", () => {
  const formatting = createLocaleFormatting(localization("en-US"));
  const timeZone = resolveRegionalTimeZone({ "regional.time-zone": "America/Manaus" });
  const instant = Date.UTC(2026, 9, 7, 12, 30, 45);

  assert.equal(
    formatting.formatPercent(0.5, { maximumFractionDigits: 0 }),
    new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(0.5),
  );
  assert.equal(
    formatting.formatDate(instant, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Manaus",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(instant)),
  );
});

test("battery surfaces use canonical formatting and regional preference owners without local legacy helpers", async () => {
  const tray = await readFile(
    new URL("../system/surface/ui/battery-tray-controls.mjs", import.meta.url),
    "utf8",
  );
  const quick = await readFile(
    new URL("../system/surface/ui/battery-quick-panel.mjs", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../system/services/i18n/catalog/power.mjs", import.meta.url),
    "utf8",
  );

  for (const source of [tray, quick]) {
    assert.match(source, /assertPreferenceRuntimePort\(surfaceRuntime\.preferences\)/);
    assert.match(source, /createLocaleFormatting\(localization\)/);
    assert.match(source, /resolveRegionalTimeZone\(preferences\.getSnapshot\(\)\)/);
    assert.match(source, /preferences\.subscribe/);
    assert.match(source, /unsubscribePreferences/);
    assert.match(source, /formatting\.formatPercent\(value \/ 100/);
    assert.match(source, /formatting\.formatDate\(lastSuccessAt/);
    assert.doesNotMatch(source, /America\/Bahia/);
    assert.doesNotMatch(source, /new Intl\.DateTimeFormat/);
    assert.doesNotMatch(source, /formatPowerReceivedAt/);
    assert.doesNotMatch(source, /\$\{value\.battery\.percent\}%/);
  }

  assert.match(catalog, /"power\.tray\.title": "Bateria \{percent\} ·/);
  assert.match(catalog, /"power\.tray\.title": "Battery \{percent\} ·/);
  assert.doesNotMatch(catalog, /\{percent\}%/);
});
