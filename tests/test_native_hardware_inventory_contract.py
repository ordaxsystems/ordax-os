from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "hardware-inventory.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "hardware-inventory.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"


class NativeHardwareInventoryContractTests(unittest.TestCase):
    def test_contract_adapter_and_host_keep_read_only_boundary(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('ordax.hardware-inventory/1', contract)
        self.assertIn('HARDWARE_INVENTORY_ENDPOINT = "/__ordax/native/hardware-inventory"', adapter)
        self.assertIn('HARDWARE_INVENTORY_PATH = "/__ordax/native/hardware-inventory"', server)
        self.assertIn("read_hardware_inventory()", server)
        self.assertRegex(
            server,
            r'parsed_path in \{[^}]*HARDWARE_INVENTORY_PATH[^}]*\} and self\.client_address\[0\] != "127\.0\.0\.1"',
        )
        post = server.split("def do_POST", 1)[1]
        self.assertNotIn("parsed_path == HARDWARE_INVENTORY_PATH", post)

    def test_capability_is_native_only_and_non_privileged(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        capability = capabilities["hardware.inventory"]
        self.assertEqual(capability["owner"], "system/adapters/native")
        self.assertEqual(
            capability["security_boundary"],
            "read-only-bounded-pci-usb-device-observability",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        for mode_id in ("usb", "native-disk"):
            self.assertIn("hardware.inventory", modes[mode_id]["baseline_capabilities"])
            self.assertNotIn("hardware.inventory", modes[mode_id]["privileged_capabilities"])
        for mode_id in ("web", "mobile", "desktop"):
            self.assertNotIn("hardware.inventory", modes[mode_id]["baseline_capabilities"])
            self.assertNotIn("hardware.inventory", modes[mode_id]["privileged_capabilities"])


if __name__ == "__main__":
    unittest.main()
