import { validateNetworkStatusSnapshot } from "../../contracts/network-status.mjs";

// The Native Surface is served from local loopback. navigator.onLine may remain
// true even when USB Wi-Fi is down, so browser "online" cannot be the sole
// recovery signal for an unreachable HTTPS Account gateway.
//
// Observe the Network Tray's EXISTING status reads; never add another timer,
// polling loop, credential store or source of network truth.
export function createAccountConnectivityRecovery({
  readIdentityState,
  refresh,
  now = () => Date.now(),
  minimumRetryMs = 30000,
}) {
  if (typeof readIdentityState !== "function" || typeof refresh !== "function"
    || typeof now !== "function" || !Number.isFinite(minimumRetryMs)
    || minimumRetryMs < 5000) {
    throw new TypeError("Invalid Account network recovery dependencies");
  }

  let disposed = false;
  let pending = false;
  let lastAttempt = null;

  return Object.freeze({
    async observe(value) {
      if (disposed) return false;
      const network = validateNetworkStatusSnapshot(value);
      if (!network.interfaces.some((entry) => entry.state === "connected")
        || readIdentityState() !== "unavailable" || pending) {
        return false;
      }
      const instant = now();
      if (!Number.isFinite(instant)
        || (lastAttempt !== null && instant - lastAttempt < minimumRetryMs)) {
        return false;
      }
      lastAttempt = instant;
      pending = true;
      try {
        await refresh();
        return true;
      } finally {
        pending = false;
      }
    },
    dispose() {
      disposed = true;
    },
  });
}
