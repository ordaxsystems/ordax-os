import {
  PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
  createEmptyProfileActivationState,
  validateProfileActivationState,
} from "../../contracts/profile-activation-state.mjs";

const ENDPOINT = "/__ordax/native/profile-activation-state";

export async function createNativeProfileActivationState(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Profile activation state requires window.fetch");
  }

  let snapshot = createEmptyProfileActivationState("device");
  let disposed = false;

  const refresh = async () => {
    if (disposed) throw new Error("Profile activation state is disposed");
    const response = await windowRef.fetch(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Native Profile activation state unavailable: ${response.status}`);
    }
    const value = validateProfileActivationState(await response.json());
    if (value.persistence !== "device") {
      throw new Error("Native Profile activation state must be device-persistent");
    }
    snapshot = value;
    return snapshot;
  };

  await refresh();

  return Object.freeze({
    schema: PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    refresh,
    dispose() {
      disposed = true;
    },
  });
}
