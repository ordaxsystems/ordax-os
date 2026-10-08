import {
  HARDWARE_INVENTORY_SCHEMA,
  assertHardwareInventoryPort,
  validateHardwareInventorySnapshot,
} from "../../contracts/hardware-inventory.mjs";

export const HARDWARE_INVENTORY_ENDPOINT = "/__ordax/native/hardware-inventory";

export async function readNativeHardwareInventory(windowRef = globalThis.window, options = {}) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native hardware-inventory adapter requires window.fetch");
  }
  const response = await windowRef.fetch(HARDWARE_INVENTORY_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Native hardware-inventory request failed: ${response.status}`);
  }
  return validateHardwareInventorySnapshot(await response.json());
}

export async function createNativeHardwareInventory(windowRef = globalThis.window) {
  const port = {
    schema: HARDWARE_INVENTORY_SCHEMA,
    read: () => readNativeHardwareInventory(windowRef),
  };
  assertHardwareInventoryPort(port);
  await port.read();
  return Object.freeze(port);
}
