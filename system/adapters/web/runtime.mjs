import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

export function createWebSurfaceHost(
  windowRef = globalThis.window,
  { identitySession = null } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Web Surface host requires a browser-like window");
  }

  const identityPort = identitySession === null
    ? null
    : assertIdentitySessionPort(identitySession);
  const listeners = new Set();
  const readSnapshot = () => {
    const accountIdentityAvailable = identityPort !== null
      && identityPort.getSnapshot().state !== "unavailable";
    return validateSurfaceSnapshot({
      capabilityIds: [
        "network.https",
        ...(accountIdentityAvailable ? ["account.identity", "sync.safe-state"] : []),
      ],
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
  const unsubscribeIdentity = identityPort?.subscribe(() => notify()) ?? (() => {});

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
