import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const POLL_INTERVAL_MS = 5000;
const NETWORK_TIME_ZONE = "America/Bahia";

export function formatNetworkReceivedAt(value, locale = "pt-BR") {
  if (!Number.isFinite(value)) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: NETWORK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function signalLevel(signalDbm) {
  if (!Number.isInteger(signalDbm)) return 0;
  if (signalDbm >= -50) return 4;
  if (signalDbm >= -60) return 3;
  if (signalDbm >= -70) return 2;
  return 1;
}

function signalMessageId(level) {
  return [
    null,
    "network.signal.weak",
    "network.signal.fair",
    "network.signal.good",
    "network.signal.strong",
  ][level] ?? null;
}

function choosePrimaryInterface(snapshot) {
  const connected = snapshot.interfaces.filter((entry) => entry.state === "connected");
  const wifi = connected
    .filter((entry) => entry.kind === "wifi")
    .sort((left, right) => (right.signalDbm ?? -999) - (left.signalDbm ?? -999))[0];
  if (wifi) return wifi;
  const ethernet = connected.find((entry) => entry.kind === "ethernet");
  if (ethernet) return ethernet;
  if (connected[0]) return connected[0];
  return (
    snapshot.interfaces.find((entry) => entry.kind === "wifi")
    ?? snapshot.interfaces.find((entry) => entry.kind === "ethernet")
    ?? snapshot.interfaces[0]
    ?? null
  );
}

function kindKey(entry) {
  if (entry?.kind === "wifi") return "wifi";
  if (entry?.kind === "ethernet") return "ethernet";
  return "other";
}

function stateCopy(entry) {
  if (!entry) {
    return {
      kind: "unknown",
      state: "unknown",
      signalLevel: 0,
      labelMessageId: "network.status.unavailable.label",
      titleMessageId: "network.status.unavailable.title",
      qualityMessageId: null,
    };
  }

  const key = kindKey(entry);
  if (entry.state !== "connected") {
    return {
      kind: entry.kind,
      state: entry.state,
      signalLevel: 0,
      labelMessageId:
        entry.state === "unknown"
          ? `network.kind.${key}`
          : `network.status.${key}.disconnected.label`,
      titleMessageId:
        entry.state === "unknown"
          ? `network.status.${key}.unknown.title`
          : `network.status.${key}.disconnected.title`,
      qualityMessageId: null,
    };
  }

  if (entry.kind === "wifi") {
    const level = signalLevel(entry.signalDbm);
    return {
      kind: "wifi",
      state: "connected",
      signalLevel: level,
      labelMessageId: "network.kind.wifi",
      titleMessageId:
        level > 0
          ? "network.status.wifi.connectedSignal.title"
          : "network.status.wifi.connected.title",
      qualityMessageId: signalMessageId(level),
    };
  }

  if (entry.kind === "ethernet") {
    return {
      kind: "ethernet",
      state: "connected",
      signalLevel: 0,
      labelMessageId: "network.kind.ethernet",
      titleMessageId: "network.status.ethernet.connected.title",
      qualityMessageId: null,
    };
  }

  return {
    kind: "other",
    state: "connected",
    signalLevel: 0,
    labelMessageId: "network.kind.other",
    titleMessageId: "network.status.other.connected.title",
    qualityMessageId: null,
  };
}

export function summarizeNetworkStatus(value) {
  const snapshot = validateNetworkStatusSnapshot(value);
  return Object.freeze(stateCopy(choosePrimaryInterface(snapshot)));
}

function localizeSummary(summary, translate) {
  const titleValues = summary.qualityMessageId
    ? { quality: translate(summary.qualityMessageId) }
    : {};
  return Object.freeze({
    ...summary,
    label: translate(summary.labelMessageId),
    title: translate(summary.titleMessageId, titleValues),
  });
}

export function mountNetworkTrayControls(
  root,
  networkStatus,
  surfaceLifecycle,
  { pollIntervalMs = POLL_INTERVAL_MS, onNetworkObservation = null } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network tray controls require a Surface root Element");
  }
  const port = assertNetworkStatusPort(networkStatus);
  if (onNetworkObservation !== null && typeof onNetworkObservation !== "function") {
    throw new TypeError("Network observation callback must be a function");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const tray = root.querySelector("[data-connectivity-tray]");
  const label = root.querySelector("[data-connectivity-label]");
  const icon = root.querySelector("[data-connectivity-icon]");
  if (!tray || !label || !icon) {
    throw new Error("Network tray controls require the shared system tray");
  }

  let destroyed = false;
  let polling = false;
  let lastSnapshot = null;
  let lastSuccessAt = null;
  let lastObservation = "unavailable";

  const receivedAt = () =>
    formatNetworkReceivedAt(lastSuccessAt, localization.getLocale())
    ?? t("network.time.unknown");

  const render = (snapshot, { stale = false } = {}) => {
    const next = localizeSummary(summarizeNetworkStatus(snapshot), t);
    lastObservation = stale ? "stale" : "current";
    tray.dataset.networkKind = next.kind;
    tray.dataset.networkState = next.state;
    tray.dataset.networkObservation = lastObservation;
    tray.title = stale
      ? t("network.tray.stale.title", { title: next.title, time: receivedAt() })
      : next.title;
    label.textContent = stale
      ? t("network.tray.stale.label", { label: next.label })
      : next.label;
    icon.dataset.state = stale
      ? "unknown"
      : next.state === "connected" ? "online" : "offline";
    icon.dataset.networkKind = next.kind;
    icon.dataset.signalLevel = String(next.signalLevel);
    tray.dataset.networkDetailOwner = "true";
  };

  const renderUnavailable = () => {
    lastObservation = "unavailable";
    tray.dataset.networkKind = "unknown";
    tray.dataset.networkState = "unknown";
    tray.dataset.networkObservation = lastObservation;
    tray.title = t("network.tray.unavailable.title");
    label.textContent = t("network.tray.unavailable.label");
    icon.dataset.state = "unknown";
    icon.dataset.networkKind = "unknown";
    icon.dataset.signalLevel = "0";
    tray.dataset.networkDetailOwner = "true";
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const snapshot = validateNetworkStatusSnapshot(await port.read());
      if (destroyed) return;
      lastSnapshot = snapshot;
      lastSuccessAt = Date.now();
      render(snapshot);
      // Share this validated observation without a second Network/status poll.
      onNetworkObservation?.(snapshot);
    } catch {
      if (destroyed) return;
      if (lastSnapshot) {
        render(lastSnapshot, { stale: true });
      } else {
        renderUnavailable();
      }
    } finally {
      if (!destroyed) polling = false;
    }
  };

  const unsubscribeLocalization = localization.subscribe(() => {
    if (destroyed) return;
    if (lastSnapshot) {
      render(lastSnapshot, { stale: lastObservation === "stale" });
    } else {
      renderUnavailable();
    }
  });

  void refresh();
  const timer = setInterval(() => void refresh(), pollIntervalMs);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      unsubscribeLocalization();
      lastSnapshot = null;
      lastSuccessAt = null;
      delete tray.dataset.networkObservation;
      delete tray.dataset.networkDetailOwner;
    },
  });
}
