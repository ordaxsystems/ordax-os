import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

export function createWebSurfaceHost(
  windowRef = globalThis.window,
  {
    readAccountIdentityAvailable = () => false,
    readSyncSafeStateAvailable = () => false,
  } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Web Surface host requires a browser-like window");
  }
  if (typeof readAccountIdentityAvailable !== "function") {
    throw new TypeError("Web Surface host account identity availability reader is required");
  }
  if (typeof readSyncSafeStateAvailable !== "function") {
    throw new TypeError("Web Surface host sync availability reader is required");
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
    return validateSurfaceSnapshot({
      capabilityIds: [
        "network.https",
        ...(accountIdentityAvailable ? ["account.identity"] : []),
        ...(syncSafeStateAvailable ? ["sync.safe-state"] : []),
      ],
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
