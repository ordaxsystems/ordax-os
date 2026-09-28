import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

const BASE_CAPABILITIES = Object.freeze([
  "surface.render",
  "network.https",
]);

function validateIdentitySessionPort(identitySession) {
  if (
    identitySession === null
    || typeof identitySession !== "object"
    || typeof identitySession.getSnapshot !== "function"
    || typeof identitySession.subscribe !== "function"
  ) {
    throw new TypeError("Native Surface host requires an identity session port");
  }
  return identitySession;
}

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
    identitySession,
  } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Native Surface host requires a browser-like window");
  }
  const liveIdentitySession = validateIdentitySessionPort(identitySession);

  const listeners = new Set();
  const readSnapshot = () => {
    const identityAvailable = liveIdentitySession.getSnapshot().state !== "unavailable";
    const capabilityIds = [...BASE_CAPABILITIES];
    if (identityAvailable) {
      capabilityIds.push("account.identity", "sync.safe-state");
    }
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
  };

  windowRef.addEventListener("online", notify);
  windowRef.addEventListener("offline", notify);
  const unsubscribeIdentity = liveIdentitySession.subscribe(notify);

  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot: readSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface host listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      unsubscribeIdentity();
      windowRef.removeEventListener("online", notify);
      windowRef.removeEventListener("offline", notify);
    },
  });
}
