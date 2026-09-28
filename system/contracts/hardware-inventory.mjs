export const HARDWARE_INVENTORY_SCHEMA = "ordax.hardware-inventory/1";

const MAX_DEVICES = 128;
const BUS_TYPES = new Set(["pci", "usb"]);

function text(value, label, max = 512) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} is outside bounds`);
  return normalized;
}

export function validateHardwareInventorySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hardware inventory snapshot must be an object");
  }
  if (!Array.isArray(value.devices) || value.devices.length > MAX_DEVICES) {
    throw new TypeError("Hardware inventory devices are outside bounds");
  }
  const devices = value.devices.map((device) => {
    if (!device || typeof device !== "object" || Array.isArray(device)) {
      throw new TypeError("Hardware inventory device must be an object");
    }
    if (!BUS_TYPES.has(device.bus)) throw new TypeError("Hardware inventory bus is unsupported");
    return Object.freeze({
      id: text(device.id, "hardware inventory device id", 64),
      bus: device.bus,
      modalias: text(device.modalias, "hardware inventory modalias"),
      driver: device.driver == null ? null : text(device.driver, "hardware inventory driver", 160),
    });
  });
  return Object.freeze({
    schema: HARDWARE_INVENTORY_SCHEMA,
    architecture: text(value.architecture, "hardware inventory architecture", 64),
    kernelAbi: text(value.kernelAbi, "hardware inventory kernel ABI", 160),
    devices: Object.freeze(devices),
  });
}

export function assertHardwareInventoryPort(port) {
  if (!port || typeof port !== "object" || port.schema !== HARDWARE_INVENTORY_SCHEMA) {
    throw new TypeError("A compatible hardware-inventory port is required");
  }
  if (typeof port.read !== "function") {
    throw new TypeError("Hardware-inventory port must implement read()");
  }
  return port;
}
