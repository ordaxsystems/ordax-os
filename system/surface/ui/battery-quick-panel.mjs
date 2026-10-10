import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { createLocaleFormatting } from "../../services/i18n/formatting.mjs";
import { resolveRegionalTimeZone } from "../../services/preferences/regional.mjs";

function stateMessageId(state) {
  const key = state === "not-charging" ? "notCharging" : state;
  return `power.state.${key}`;
}

function externalPowerMessageId(externalPower) {
  if (externalPower === true) return "power.external.connected";
  if (externalPower === false) return "power.external.disconnected";
  return "power.external.unknown";
}

export function mountBatteryQuickPanel(root, powerStatus, surfaceRuntime) {
  if (!(root instanceof Element)) {
    throw new TypeError("Battery quick panel requires a Surface root Element");
  }
  const port = assertPowerStatusPort(powerStatus);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceRuntime);
  const preferences = assertPreferenceRuntimePort(surfaceRuntime.preferences);
  const localization = lifecycle.localization;
  const formatting = createLocaleFormatting(localization);
  const t = localization.translate;
  const panel = root.querySelector('[data-quick-panel="battery"]');
  const percent = root.querySelector("[data-quick-battery-percent]");
  const state = root.querySelector("[data-quick-battery-state]");
  const power = root.querySelector("[data-quick-battery-power]");
  if (!panel || !percent || !state || !power) {
    throw new Error("Battery quick panel requires shared shell slots");
  }

  let destroyed = false;
  let pending = false;
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
    panel.dataset.powerObservation = lastObservation;

    if (value.battery === null) {
      percent.textContent = "--%";
      state.textContent = stale
        ? t("power.quick.notDetectedStale", { time: receivedAt() })
        : t("power.quick.notDetected");
      power.textContent = t(externalPowerMessageId(value.externalPower));
      return;
    }

    percent.textContent = formatBatteryPercent(value.battery.percent);
    const stateLabel = t(stateMessageId(value.battery.state));
    state.textContent = stale
      ? t("power.quick.stateStale", { state: stateLabel, time: receivedAt() })
      : stateLabel;
    power.textContent = t(externalPowerMessageId(value.externalPower));
  };

  const renderUnavailable = () => {
    lastObservation = "unavailable";
    panel.dataset.powerObservation = lastObservation;
    percent.textContent = "--%";
    state.textContent = t("power.quick.unavailable.state");
    power.textContent = t("power.quick.unavailable.external");
  };

  const renderInitial = () => {
    state.textContent = t("shell.quick.batteryReading");
    power.textContent = t("shell.quick.checking");
  };

  const rerenderPresentation = () => {
    if (destroyed) return;
    if (lastSnapshot) {
      render(lastSnapshot, { stale: lastObservation === "stale" });
    } else if (lastObservation === "unavailable") {
      renderUnavailable();
    } else {
      renderInitial();
    }
  };

  const refresh = async () => {
    if (destroyed || pending) return;
    pending = true;
    try {
      const snapshot = validatePowerStatusSnapshot(await port.read());
      if (destroyed) return;
      lastSnapshot = snapshot;
      lastSuccessAt = Date.now();
      render(snapshot);
    } catch {
      if (destroyed) return;
      if (lastSnapshot) {
        render(lastSnapshot, { stale: true });
      } else {
        renderUnavailable();
      }
    } finally {
      if (!destroyed) pending = false;
    }
  };

  const onOpen = () => {
    void refresh();
  };

  panel.addEventListener("ordax:quick-panel-open", onOpen);

  const unsubscribeLocalization = localization.subscribe(() => {
    rerenderPresentation();
  });
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    const nextTimeZone = resolveRegionalTimeZone(snapshot);
    if (nextTimeZone === observedTimeZone) return;
    observedTimeZone = nextTimeZone;
    rerenderPresentation();
  });

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      unsubscribeLocalization();
      unsubscribePreferences();
      lastSnapshot = null;
      lastSuccessAt = null;
      delete panel.dataset.powerObservation;
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
    },
  });
}
