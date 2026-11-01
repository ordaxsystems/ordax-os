import {
  DEVICE_PROFILE_PORT_SCHEMA,
  assertDeviceProfilePort,
  validateDeviceDisplayName,
  validateDeviceProfile,
} from "../../contracts/device-profile.mjs";

const DEVICE_PROFILE_ENDPOINT = "/__ordax/native/device-profile";

export async function createNativeDeviceProfile(windowRef = globalThis.window, { signal = null } = {}) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native device profile requires window.fetch");
  }

  const response = await windowRef.fetch(DEVICE_PROFILE_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Native device profile unavailable: ${response.status}`);
  }
  let snapshot = validateDeviceProfile(await response.json());

  const port = {
    schema: DEVICE_PROFILE_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    async rename(displayName) {
      const normalized = validateDeviceDisplayName(displayName);
      const result = await windowRef.fetch(DEVICE_PROFILE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: normalized }),
      });
      if (!result.ok) {
        throw new Error(`Native device rename failed: ${result.status}`);
      }
      snapshot = validateDeviceProfile(await result.json());
      return snapshot;
    },
  };

  assertDeviceProfilePort(port);
  return Object.freeze(port);
}
