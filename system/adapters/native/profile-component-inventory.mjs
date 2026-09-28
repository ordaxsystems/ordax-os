import {
  PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA,
  createEmptyProfileComponentInventory,
  validateProfileComponentInventory,
} from "../../contracts/profile-component-inventory.mjs";

const ENDPOINT = "/__ordax/native/profile-component-inventory";

export async function createNativeProfileComponentInventory(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Profile component inventory requires window.fetch");
  }

  let snapshot = createEmptyProfileComponentInventory();
  let disposed = false;

  const refresh = async () => {
    if (disposed) throw new Error("Profile component inventory is disposed");
    const response = await windowRef.fetch(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Native Profile component inventory unavailable: ${response.status}`);
    }
    snapshot = validateProfileComponentInventory(await response.json());
    return snapshot;
  };

  await refresh();

  return Object.freeze({
    schema: PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    refresh,
    dispose() {
      disposed = true;
    },
  });
}

