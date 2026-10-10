import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const NOTIFICATION_CONTROLS = new URL(
  "../system/surface/ui/notification-center-controls.mjs",
  import.meta.url,
);

test("Notification Center uses canonical regional formatting without a local time-zone owner", async () => {
  const source = await readFile(NOTIFICATION_CONTROLS, "utf8");

  assert.match(source, /assertPreferenceRuntimePort\(surfaceRuntime\.preferences\)/);
  assert.match(source, /createLocaleFormatting\(localization\)/);
  assert.match(source, /resolveRegionalTimeZone\(preferences\.getSnapshot\(\)\)/);
  assert.match(source, /formatting\.formatDate\(date,/);
  assert.match(source, /preferences\.subscribe/);
  assert.match(source, /unsubscribePreferences/);
  assert.doesNotMatch(source, /NOTIFICATION_TIME_ZONE/);
  assert.doesNotMatch(source, /America\/Bahia/);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat/);
  assert.doesNotMatch(source, /function formatTimestamp/);
});

test("invalid notification timestamps fail to localized unavailable copy before ISO serialization", async () => {
  const source = await readFile(NOTIFICATION_CONTROLS, "utf8");
  const invalidCheck = source.indexOf("if (Number.isNaN(date.getTime()))");
  const removeDateTime = source.indexOf('time.removeAttribute("datetime")');
  const unavailableCopy = source.indexOf('translate("notifications.time.unavailable")');
  const returnFromInvalid = source.indexOf("return;", invalidCheck);
  const toIsoString = source.indexOf("date.toISOString()", invalidCheck);

  assert.notEqual(invalidCheck, -1);
  assert.ok(removeDateTime > invalidCheck);
  assert.ok(unavailableCopy > removeDateTime);
  assert.ok(returnFromInvalid > unavailableCopy);
  assert.ok(toIsoString > returnFromInvalid);
});
