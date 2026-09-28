import assert from "node:assert/strict";
import test from "node:test";

import {
  HARDWARE_INVENTORY_SCHEMA,
  validateHardwareInventorySnapshot,
} from "../system/contracts/hardware-inventory.mjs";

test("hardware inventory validates bounded PCI/USB projection", () => {
  const snapshot = validateHardwareInventorySnapshot({
    architecture: "x86_64",
    kernelAbi: "6.6.52-ordax",
    devices: [
      { id: "device-001", bus: "pci", modalias: "pci:v00008086d00002723", driver: "iwlwifi" },
      { id: "device-002", bus: "usb", modalias: "usb:v0BDAp8153", driver: "r8152" },
    ],
  });
  assert.equal(snapshot.schema, HARDWARE_INVENTORY_SCHEMA);
  assert.equal(snapshot.devices.length, 2);
});

test("hardware inventory refuses unsupported bus and empty modalias", () => {
  assert.throws(() => validateHardwareInventorySnapshot({
    architecture: "x86_64",
    kernelAbi: "6.6.52-ordax",
    devices: [{ id: "device-001", bus: "bluetooth", modalias: "x", driver: null }],
  }), /bus/);
  assert.throws(() => validateHardwareInventorySnapshot({
    architecture: "x86_64",
    kernelAbi: "6.6.52-ordax",
    devices: [{ id: "device-001", bus: "pci", modalias: "", driver: null }],
  }), /modalias/);
});
