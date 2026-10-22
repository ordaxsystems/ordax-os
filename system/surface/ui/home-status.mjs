import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import {
  assertSystemMetricsPort,
  validateSystemMetricsSnapshot,
} from "../../contracts/system-metrics.mjs";
import {
  assertSyncRuntimePort,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import {
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const GIBIBYTE = 1024 ** 3;
const MEBIBYTE = 1024 ** 2;

function assertHomeStatus(root) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Home status requires a Surface root");
  }
  const section = root.querySelector(".ordax-home-status");
  if (!section) throw new Error("Home status requires the canonical Home status section");
  return section;
}

function message(translate, messageId, state) {
  return Object.freeze({ text: translate(messageId), state });
}

function networkValue(snapshot, sourceState, translate) {
  if (sourceState !== "ready" || !snapshot) {
    return message(translate, sourceState === "loading" ? "home.status.loading" : "home.status.unavailable", sourceState);
  }
  const connected = snapshot.interfaces.find((item) => item.state === "connected");
  if (connected) {
    const key = connected.kind === "wifi"
      ? "home.status.network.wifi"
      : connected.kind === "ethernet"
        ? "home.status.network.ethernet"
        : "home.status.network.connected";
    return message(translate, key, "success");
  }
  if (snapshot.interfaces.length === 0) {
    return message(translate, "home.status.network.none", "warning");
  }
  if (snapshot.interfaces.some((item) => item.state === "unknown")) {
    return message(translate, "home.status.network.unknown", "neutral");
  }
  return message(translate, "home.status.network.disconnected", "warning");
}

function accountValue(snapshot, sourceState, translate) {
  if (sourceState !== "ready" || !snapshot || snapshot.state === "unavailable") {
    return message(translate, sourceState === "loading" ? "home.status.loading" : "home.status.unavailable", sourceState);
  }
  return snapshot.state === "signed-in"
    ? message(translate, "home.status.account.connected", "success")
    : message(translate, "home.status.account.signedOut", "neutral");
}

function syncValue(snapshot, sourceState, translate, locale) {
  if (sourceState !== "ready" || !snapshot) {
    return message(translate, sourceState === "loading" ? "home.status.loading" : "home.status.unavailable", sourceState);
  }
  if (snapshot.pendingMutationCount > 0) {
    const count = new Intl.NumberFormat(locale).format(snapshot.pendingMutationCount);
    const noun = translate(snapshot.pendingMutationCount === 1
      ? "home.status.sync.pendingOne"
      : "home.status.sync.pendingMany");
    return Object.freeze({ text: count + " " + noun, state: "pending" });
  }
  if (snapshot.accountContinuity === "active" && snapshot.transport === "available") {
    return message(translate, "home.status.sync.current", "success");
  }
  if (snapshot.transport === "host-required") {
    return message(translate, "home.status.sync.waiting", "neutral");
  }
  return message(translate, "home.status.account.signedOut", "neutral");
}

function storageValue(snapshot, sourceState, translate, locale) {
  if (sourceState !== "ready" || !snapshot || snapshot.userStorageTotalBytes === 0) {
    return message(translate, sourceState === "loading" ? "home.status.loading" : "home.status.unavailable", sourceState);
  }
  const unit = snapshot.userStorageTotalBytes >= GIBIBYTE ? GIBIBYTE : MEBIBYTE;
  const unitLabel = unit === GIBIBYTE ? "GB" : "MB";
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const used = snapshot.userStorageTotalBytes - snapshot.userStorageFreeBytes;
  return Object.freeze({
    text: format.format(used / unit) + " / " + format.format(snapshot.userStorageTotalBytes / unit) + " " + unitLabel,
    state: "success",
  });
}

const UPDATE_PHASES = Object.freeze({
  checking: ["home.status.updates.checking", "pending"],
  fetching: ["home.status.updates.fetching", "pending"],
  validating: ["home.status.updates.validating", "pending"],
  activating: ["home.status.updates.activating", "pending"],
  "health-wait": ["home.status.updates.finalizing", "pending"],
  rollback: ["home.status.updates.rollback", "warning"],
  blocked: ["home.status.updates.blocked", "warning"],
  error: ["home.status.updates.error", "warning"],
});

const UPDATE_STATES = Object.freeze({
  running: ["home.status.updates.active", "success"],
  applied: ["home.status.updates.applied", "success"],
  updating: ["home.status.updates.fetching", "pending"],
  "network-error": ["home.status.updates.networkError", "warning"],
  "remote-error": ["home.status.updates.sourceError", "warning"],
  "pull-error": ["home.status.updates.error", "warning"],
  "rolled-back": ["home.status.updates.rollback", "warning"],
  rejected: ["home.status.updates.blocked", "warning"],
  pinned: ["home.status.updates.paused", "neutral"],
  disabled: ["home.status.unavailable", "unavailable"],
  unavailable: ["home.status.unavailable", "unavailable"],
});

function updateValue(snapshot, sourceState, translate) {
  if (sourceState !== "ready" || !snapshot) {
    return message(translate, sourceState === "loading" ? "home.status.loading" : "home.status.unavailable", sourceState);
  }
  if (snapshot.bootRefreshRequired) {
    return message(translate, "home.status.updates.basePending", "warning");
  }
  if (snapshot.manualCheckPending) {
    return message(translate, "home.status.updates.checking", "pending");
  }
  const phase = UPDATE_PHASES[snapshot.phase];
  if (phase) return message(translate, phase[0], phase[1]);
  const status = UPDATE_STATES[snapshot.status];
  return status
    ? message(translate, status[0], status[1])
    : message(translate, "home.status.unavailable", "unavailable");
}

export function mountHomeStatus(rootValue, {
  networkStatus = null,
  identitySession = null,
  syncRuntime = null,
  systemMetrics = null,
  updateStatus = null,
  surfaceLifecycle = null,
} = {}) {
  const root = rootValue;
  const section = assertHomeStatus(root);
  const networkPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const identityPort = identitySession === null ? null : assertIdentitySessionPort(identitySession);
  const syncPort = syncRuntime === null ? null : assertSyncRuntimePort(syncRuntime);
  const metricsPort = systemMetrics === null ? null : assertSystemMetricsPort(systemMetrics);
  const updatePort = updateStatus === null ? null : assertUpdateStatusPort(updateStatus);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  const connection = section.querySelector("[data-home-status-connection]");
  const note = section.querySelector("[data-home-status-note]");
  const values = new Map(Array.from(section.querySelectorAll("[data-home-status-value]"))
    .map((element) => [element.dataset.homeStatusValue, element]));
  const state = {
    network: null,
    account: identityPort ? validateIdentitySessionSnapshot(identityPort.getSnapshot()) : null,
    sync: syncPort ? validateSyncRuntimeSnapshot(syncPort.getSnapshot()) : null,
    storage: null,
    updates: updatePort?.getSnapshot() ?? null,
  };
  const sourceState = {
    network: networkPort ? "loading" : "unavailable",
    account: identityPort && state.account.state !== "unavailable" ? "ready" : "unavailable",
    sync: syncPort ? "ready" : "unavailable",
    storage: metricsPort ? "loading" : "unavailable",
    updates: updatePort ? (state.updates ? "ready" : "loading") : "unavailable",
  };
  let destroyed = false;
  let refreshing = false;

  const render = () => {
    if (destroyed) return;
    const translate = localization.translate;
    const locale = localization.getLocale();
    const presentation = {
      internet: networkValue(state.network, sourceState.network, translate),
      account: accountValue(state.account, sourceState.account, translate),
      sync: syncValue(state.sync, sourceState.sync, translate, locale),
      storage: storageValue(state.storage, sourceState.storage, translate, locale),
      updates: updateValue(state.updates, sourceState.updates, translate),
    };
    for (const [key, item] of Object.entries(presentation)) {
      const element = values.get(key);
      if (!element) continue;
      element.textContent = item.text;
      element.dataset.state = item.state;
    }

    const availableCount = Object.values(sourceState).filter((value) => value === "ready").length;
    const unavailableCount = Object.values(sourceState).filter((value) => value === "unavailable").length;
    const loadingCount = Object.values(sourceState).filter((value) => value === "loading").length;
    const connectionState = loadingCount > 0 && availableCount === 0
      ? "loading"
      : availableCount === 0
        ? "unavailable"
        : unavailableCount === 0 && loadingCount === 0
          ? "ready"
          : "partial";
    if (connection) {
      const messageId = connectionState === "loading"
        ? "home.status.loading"
        : connectionState === "ready"
          ? "home.status.connection.ready"
          : connectionState === "partial"
            ? "home.status.connection.partial"
            : "home.status.connection.unavailable";
      connection.textContent = translate(messageId);
      connection.dataset.state = connectionState;
    }
    if (note) {
      const messageId = connectionState === "loading"
        ? "home.status.note.loading"
        : connectionState === "ready"
          ? "home.status.note.ready"
          : connectionState === "partial"
            ? "home.status.note.partial"
            : "home.status.note.unavailable";
      note.textContent = translate(messageId);
    }
  };

  const refreshReadPorts = async () => {
    if (destroyed || refreshing) return;
    refreshing = true;
    const reads = [
      ["network", networkPort, validateNetworkStatusSnapshot],
      ["storage", metricsPort, validateSystemMetricsSnapshot],
    ].filter(([, port]) => port !== null);
    await Promise.all(reads.map(async ([key, port, validate]) => {
      try {
        const snapshot = validate(await port.read());
        if (destroyed) return;
        state[key] = snapshot;
        sourceState[key] = "ready";
      } catch {
        if (destroyed) return;
        state[key] = null;
        sourceState[key] = "unavailable";
      }
    }));
    refreshing = false;
    render();
  };

  const unsubscribeIdentity = identityPort?.subscribe((snapshot) => {
    state.account = validateIdentitySessionSnapshot(snapshot);
    sourceState.account = state.account.state === "unavailable" ? "unavailable" : "ready";
    render();
  });
  const unsubscribeSync = syncPort?.subscribe((snapshot) => {
    state.sync = validateSyncRuntimeSnapshot(snapshot);
    sourceState.sync = "ready";
    render();
  });
  const unsubscribeUpdates = updatePort?.subscribe((snapshot) => {
    state.updates = validateUpdateStatusSnapshot(snapshot);
    sourceState.updates = "ready";
    render();
  });
  const unsubscribeLocalization = localization.subscribe(render);
  const onRefresh = () => { void refreshReadPorts(); };
  const onVisibilityChange = () => {
    if (documentObject.visibilityState === "visible") onRefresh();
  };
  windowObject?.addEventListener("online", onRefresh, { passive: true });
  windowObject?.addEventListener("offline", onRefresh, { passive: true });
  windowObject?.addEventListener("focus", onRefresh, { passive: true });
  documentObject.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  render();
  void refreshReadPorts();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIdentity?.();
      unsubscribeSync?.();
      unsubscribeUpdates?.();
      unsubscribeLocalization?.();
      windowObject?.removeEventListener("online", onRefresh);
      windowObject?.removeEventListener("offline", onRefresh);
      windowObject?.removeEventListener("focus", onRefresh);
      documentObject.removeEventListener("visibilitychange", onVisibilityChange);
    },
  });
}
