import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import { deriveAccountSurfaceCapabilityIds } from "../../services/account/runtime.mjs";

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
  let current = null;
  let disposed = false;
  const readSnapshot = () => {
    const accountCapabilities = deriveAccountSurfaceCapabilityIds({
      accountIdentityAvailable: readAccountIdentityAvailable(),
      syncSafeStateAvailable: readSyncSafeStateAvailable(),
    });
    return validateSurfaceSnapshot({
      capabilityIds: ["network.https", ...accountCapabilities],
      // A browser hint only; this does not prove server or device availability.
      connectivity: windowRef.navigator.onLine === true ? "online"
        : windowRef.navigator.onLine === false ? "offline" : "unknown",
    });
  };

  const getSnapshot = () => {
    if (current === null) current = readSnapshot();
    return current;
  };
  const notify = () => {
    if (disposed) return getSnapshot();
    const next = readSnapshot();
    if (current !== null && current.connectivity === next.connectivity
      && current.capabilityIds.length === next.capabilityIds.length
      && current.capabilityIds.every((id, index) => id === next.capabilityIds[index])) {
      return current;
    }
    current = next;
    for (const listener of [...listeners]) listener(current);
    return current;
  };

  windowRef.addEventListener("online", notify);
  windowRef.addEventListener("offline", notify);

  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot,
    refresh: notify,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface host listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      windowRef.removeEventListener("online", notify);
      windowRef.removeEventListener("offline", notify);
    },
  });
}
