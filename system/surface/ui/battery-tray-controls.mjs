import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { createLocaleFormatting } from "../../services/i18n/formatting.mjs";
import { resolveRegionalTimeZone } from "../../services/preferences/regional.mjs";

const POLL_INTERVAL_MS = 30000;

function batteryLevel(percent) {
  if (percent <= 10) return 0;
  if (percent <= 25) return 1;
  if (percent <= 50) return 2;
  if (percent <= 75) return 3;
  return 4;
}

// Validated power snapshots have a bounded, fixed shape. Compare the exact
// visible battery/external-power values without JSON conversion or caches.
export function samePowerTraySnapshot(previous, next) {
  if (previous === null || next === null) return false;
  if (previous.externalPower !== next.externalPower) return false;
  if (previous.battery === null || next.battery === null) {
    return previous.battery === next.battery;
  }
  return previous.battery.percent === next.battery.percent
    && previous.battery.state === next.battery.state;
}

function stateKey(state) {
  return state === "not-charging" ? "notCharging" : state;
}

function externalTitleMessageId(externalPower) {
  if (externalPower === true) return "power.tray.external.connected";
  if (externalPower === false) return "power.tray.external.disconnected";
  return null;
}

function batteryTitle(battery, externalPower, translate, formattedPercent) {
  const state = translate(`power.stateTitle.${stateKey(battery.state)}`);
  const externalMessageId = externalTitleMessageId(externalPower);
  const external = externalMessageId ? translate(externalMessageId) : "";
  return translate("power.tray.title", {
    percent: formattedPercent,
    state,
    external,
  });
}

export function mountBatteryTrayControls(
  root,
  powerStatus,
  surfaceRuntime,
  { pollIntervalMs = POLL_INTERVAL_MS } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Battery tray controls require a Surface root Element");
  }
  const port = assertPowerStatusPort(powerStatus);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceRuntime);
  const preferences = assertPreferenceRuntimePort(surfaceRuntime.preferences);
  const localization = lifecycle.localization;
  const formatting = createLocaleFormatting(localization);
  const t = localization.translate;
  const item = root.querySelector("[data-battery-tray]");
  const icon = root.querySelector("[data-battery-icon]");
  const label = root.querySelector("[data-battery-label]");
  if (!item || !icon || !label) {
    throw new Error("Battery tray controls require the shared system tray");
  }

  let destroyed = false;
  let polling = false;
  let lastSnapshot = null;
  let lastSuccessAt = null;
  let lastObservation = "initial";
  let observedTimeZone = resolveRegionalTimeZone(preferences.getSnapshot());

  const formatBatteryPercent = (value) =>
    formatting.formatPercent(value / 100, { maximumFractionDigits: 0 });

  const receivedAt = () => Number.isFinite(lastSuccessAt)
    ? formatting.formatDate(lastSuccessAt, {
        timeZone: observedTimeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : t("power.time.unknown");

  const render = (snapshot, { stale = false } = {}) => {
    const value = validatePowerStatusSnapshot(snapshot);
    lastObservation = stale ? "stale" : "current";
    item.hidden = false;
    item.dataset.batteryObservation = lastObservation;
    item.dataset.externalPower =
      value.externalPower === null ? "unknown" : String(value.externalPower);

    if (value.battery === null) {
      item.dataset.batteryState = "not-detected";
      icon.dataset.batteryLevel = "unknown";
      icon.dataset.charging = "false";
      label.textContent = stale
        ? t("power.tray.notDetected.staleLabel")
        : "--";
      item.title = stale
        ? t("power.tray.notDetected.staleTitle", { time: receivedAt() })
        : t("power.tray.notDetected.title");
      return;
    }

    item.dataset.batteryState = value.battery.state;
    icon.dataset.batteryLevel = stale
      ? "unknown"
      : String(batteryLevel(value.battery.percent));
    icon.dataset.charging = stale ? "false" : String(value.battery.state === "charging");
    const labelValue = formatBatteryPercent(value.battery.percent);
    label.textContent = stale
      ? t("power.tray.stale.label", { label: labelValue })
      : labelValue;
    const title = batteryTitle(value.battery, value.externalPower, t, labelValue);
    item.title = stale
      ? t("power.tray.stale.title", { title, time: receivedAt() })
      : title;
  };

  const renderUnavailable = () => {
    lastObservation = "unavailable";
    item.hidden = false;
    item.dataset.batteryState = "unavailable";
    item.dataset.batteryObservation = lastObservation;
    item.dataset.externalPower = "unknown";
    icon.dataset.batteryLevel = "unknown";
    icon.dataset.charging = "false";
    label.textContent = "--";
    item.title = t("power.tray.unavailable.title");
  };

  const rerenderPresentation = () => {
    if (destroyed || lastObservation === "initial") return;
    if (lastSnapshot) {
      render(lastSnapshot, { stale: lastObservation === "stale" });
    } else {
      renderUnavailable();
    }
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const snapshot = validatePowerStatusSnapshot(await port.read());
      if (destroyed) return;
      const unchanged = samePowerTraySnapshot(lastSnapshot, snapshot)
        && lastObservation === "current";
      lastSnapshot = snapshot;
      // Keep the most recent successful observation time, even when the
      // visible values do not change. A later failure must use this time.
      lastSuccessAt = Date.now();
      if (!unchanged) render(snapshot);
    } catch {
      if (destroyed) return;
      if (lastSnapshot) {
        if (lastObservation !== "stale") render(lastSnapshot, { stale: true });
      } else if (lastObservation !== "unavailable") {
        renderUnavailable();
      }
    } finally {
      if (!destroyed) polling = false;
    }
  };

  const unsubscribeLocalization = localization.subscribe(() => {
    rerenderPresentation();
  });
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    const nextTimeZone = resolveRegionalTimeZone(snapshot);
    if (nextTimeZone === observedTimeZone) return;
    observedTimeZone = nextTimeZone;
    rerenderPresentation();
  });

  void refresh();
  const timer = setInterval(() => void refresh(), pollIntervalMs);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      unsubscribeLocalization();
      unsubscribePreferences();
      lastSnapshot = null;
      lastSuccessAt = null;
      delete item.dataset.batteryObservation;
    },
  });
}
