import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

const BASE_CAPABILITIES = Object.freeze([
  "surface.render",
  "network.https",
]);

export function createNativeSurfaceHost(
  windowRef = globalThis.window,
  {
    bootControlAvailable = false,
    userFileSpaceAvailable = false,
    systemMetricsAvailable = false,
    powerStatusAvailable = false,
    networkStatusAvailable = false,
    networkManagementAvailable = false,
    keyboardLayoutAvailable = false,
    browserWebContentAvailable = false,
    intelligenceSystemAvailable = false,
    localSessionAvailable = false,
    readAccountIdentityAvailable = () => false,
    readSyncSafeStateAvailable = () => false,
  } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Native Surface host requires a browser-like window");
  }
  if (typeof readAccountIdentityAvailable !== "function") {
    throw new TypeError("Native Surface host account identity availability reader is required");
  }
  if (typeof readSyncSafeStateAvailable !== "function") {
    throw new TypeError("Native Surface host sync availability reader is required");
  }

  const listeners = new Set();
  const readSnapshot = () => {
    const accountIdentityAvailable = readAccountIdentityAvailable();
    const syncSafeStateAvailable = readSyncSafeStateAvailable();
    if (typeof accountIdentityAvailable !== "boolean") {
      throw new TypeError("account identity availability reader must return a boolean");
    }
    if (typeof syncSafeStateAvailable !== "boolean") {
      throw new TypeError("sync availability reader must return a boolean");
    }
    if (syncSafeStateAvailable && !accountIdentityAvailable) {
      throw new TypeError("sync.safe-state requires account.identity");
    }
    const capabilityIds = [...BASE_CAPABILITIES];
    if (accountIdentityAvailable) capabilityIds.push("account.identity");
    if (syncSafeStateAvailable) capabilityIds.push("sync.safe-state");
    if (userFileSpaceAvailable) {
      capabilityIds.push("filesystem.user-space");
    }
    if (systemMetricsAvailable) {
      capabilityIds.push("system.metrics");
    }
    if (powerStatusAvailable) {
      capabilityIds.push("power.status");
    }
    if (networkStatusAvailable) {
      capabilityIds.push("network.status");
    }
    if (networkManagementAvailable) {
      capabilityIds.push("network.management");
    }
    if (keyboardLayoutAvailable) {
      capabilityIds.push("input.keyboard-layout");
    }
    if (browserWebContentAvailable) {
      capabilityIds.push("browser.web-content");
    }
    if (intelligenceSystemAvailable) {
      capabilityIds.push("intelligence.system");
    }
    if (localSessionAvailable) {
      capabilityIds.push("session.local-lock");
    }
    if (bootControlAvailable) {
      capabilityIds.push("system.boot-control");
    }
    return validateSurfaceSnapshot({
      capabilityIds,
      connectivity: windowRef.navigator.onLine ? "online" : "offline",
    });
  };

  const notify = () => {
    const snapshot = readSnapshot();
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
    return snapshot;
  };

  windowRef.addEventListener("online", notify);
  windowRef.addEventListener("offline", notify);

  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot: readSnapshot,
    refresh: notify,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface host listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      windowRef.removeEventListener("online", notify);
      windowRef.removeEventListener("offline", notify);
    },
  });
}
