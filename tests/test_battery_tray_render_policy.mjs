import assert from "node:assert/strict";
import test from "node:test";

import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { validatePowerStatusSnapshot, POWER_STATUS_SCHEMA } from "../system/contracts/power-status.mjs";
import {
  mountBatteryTrayControls,
  samePowerTraySnapshot,
} from "../system/surface/ui/battery-tray-controls.mjs";

const status = (percent, state = "discharging", externalPower = false) =>
  validatePowerStatusSnapshot({
    battery: percent === null ? null : { percent, state },
    externalPower,
  });

test("battery tray equality checks every canonical visible power field", () => {
  assert.equal(samePowerTraySnapshot(null, status(65)), false);
  assert.equal(samePowerTraySnapshot(status(65), status(65)), true);
  assert.equal(samePowerTraySnapshot(status(65), status(64)), false);
  assert.equal(samePowerTraySnapshot(status(65), status(65, "charging")), false);
  assert.equal(samePowerTraySnapshot(status(65), status(65, "discharging", true)), false);
  assert.equal(samePowerTraySnapshot(status(null), status(null)), true);
  assert.equal(samePowerTraySnapshot(status(null), status(0)), false);
  assert.equal(samePowerTraySnapshot(status(null, "unknown", null), status(null)), false);
});

test("native battery tray renders only changed values or observation transitions", async () => {
  const originalElement = globalThis.Element;
  class FakeElement {}
  globalThis.Element = FakeElement;
  let localeListener;
  let preferenceListener;
  let unsubscribed = 0;
  const labelWrites = [];
  const label = {
    get textContent() { return labelWrites.at(-1); },
    set textContent(value) { labelWrites.push(value); },
  };
  const item = { dataset: {}, hidden: false, title: "" };
  const icon = { dataset: {} };
  class FakeRoot extends FakeElement {
    querySelector(selector) {
      return {
        "[data-battery-tray]": item,
        "[data-battery-icon]": icon,
        "[data-battery-label]": label,
      }[selector] ?? null;
    }
  }
  const localization = {
    schema: "ordax.localization/2",
    getLocale: () => "pt-BR",
    getProfile: () => createLocaleProfile("pt-BR"),
    translate: (id) => id,
    subscribe(listener) { localeListener = listener; return () => { unsubscribed++; }; },
  };
  const preferences = {
    schema: "ordax.preference-runtime/1",
    getSnapshot: () => ({}),
    set() {},
    subscribe(listener) { preferenceListener = listener; return () => { unsubscribed++; }; },
  };
  const lifecycle = {
    schema: "ordax.surface-render-lifecycle/5",
    localization,
    preferences,
    subscribeRender() { return () => {}; },
    getAppTarget() { return null; },
    setAppTarget() {},
  };
  const observations = [
    status(65), status(65), new Error("offline"), new Error("offline"),
    status(65), status(64), status(64, "charging"), status(null),
  ];
  const port = {
    schema: POWER_STATUS_SCHEMA,
    async read() {
      const next = observations.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error("unplanned read");
      return next;
    },
  };
  let tray;
  try {
    tray = mountBatteryTrayControls(new FakeRoot(), port, lifecycle, {
      pollIntervalMs: 300000,
    });
    // The mount starts a single immediate observation.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(item.dataset.batteryObservation, "current");
    assert.equal(labelWrites.length, 1);
    await tray.refresh(); // same percent/state/power
    assert.equal(labelWrites.length, 1, "same snapshot is a no-op for DOM");
    await tray.refresh(); // first failed read
    assert.equal(item.dataset.batteryObservation, "stale");
    assert.equal(labelWrites.length, 2, "stale transition is visible");
    await tray.refresh(); // repeated failure
    assert.equal(labelWrites.length, 2, "repeated stale state is a no-op");
    await tray.refresh(); // recovery with unchanged values
    assert.equal(item.dataset.batteryObservation, "current");
    assert.equal(labelWrites.length, 3, "recovery clears stale warning");
    await tray.refresh(); // changed percent
    assert.equal(labelWrites.length, 4);
    await tray.refresh(); // changed charging state
    assert.equal(labelWrites.length, 5);
    await tray.refresh(); // undetected battery
    assert.equal(item.dataset.batteryState, "not-detected");
    assert.equal(labelWrites.length, 6);
    localeListener();
    assert.equal(labelWrites.length, 7, "locale change still forces new copy");
    preferenceListener({ "regional.time-zone": "America/Sao_Paulo" });
    assert.equal(labelWrites.length, 8, "time-zone change updates presentation");
  } finally {
    tray?.destroy();
    globalThis.Element = originalElement;
  }
  assert.equal(unsubscribed, 2, "owner releases both subscriptions");
  assert.equal(item.dataset.batteryObservation, undefined);
});
