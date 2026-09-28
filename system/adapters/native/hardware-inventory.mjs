import {
  HARDWARE_INVENTORY_SCHEMA,
  assertHardwareInventoryPort,
  validateHardwareInventorySnapshot,
} from "../../contracts/hardware-inventory.mjs";

export const HARDWARE_INVENTORY_ENDPOINT = "/__ordax/native/hardware-inventory";

export async function createNativeHardwareInventory(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native hardware-inventory adapter requires window.fetch");
  }
  const port = {
    schema: HARDWARE_INVENTORY_SCHEMA,
    async read() {
      const response = await windowRef.fetch(HARDWARE_INVENTORY_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native hardware-inventory request failed: ${response.status}`);
      }
      return validateHardwareInventorySnapshot(await response.json());
    },
  };
  assertHardwareInventoryPort(port);
  await port.read();
  return Object.freeze(port);
}
