import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

function validateIdentitySessionPort(identitySession) {
  if (
    identitySession === null
    || typeof identitySession !== "object"
    || typeof identitySession.getSnapshot !== "function"
    || typeof identitySession.subscribe !== "function"
  ) {
    throw new TypeError("Web Surface host requires an identity session port");
  }
  return identitySession;
}

export function createWebSurfaceHost(
  windowRef = globalThis.window,
  { identitySession } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Web Surface host requires a browser-like window");
  }
  const liveIdentitySession = validateIdentitySessionPort(identitySession);
  const listeners = new Set();
  const readSnapshot = () => {
    const identityAvailable = liveIdentitySession.getSnapshot().state !== "unavailable";
    return validateSurfaceSnapshot({
      capabilityIds: [
        "network.https",
        ...(identityAvailable ? ["account.identity", "sync.safe-state"] : []),
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
