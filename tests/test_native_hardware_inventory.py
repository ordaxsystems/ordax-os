from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_hardware_inventory.py"
spec = importlib.util.spec_from_file_location("ordax_native_hardware_inventory", MODULE)
inventory = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(inventory)


class NativeHardwareInventoryTests(unittest.TestCase):
    def test_inventory_reads_only_bounded_modalias_and_driver_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pci = root / "pci"
            usb = root / "usb"
            device = pci / "0000:00:14.3"
            driver = root / "drivers" / "iwlwifi"
            device.mkdir(parents=True)
            usb.mkdir()
            driver.mkdir(parents=True)
            (device / "modalias").write_text("pci:v00008086d00002723\n", encoding="utf-8")
            (device / "driver").symlink_to(driver, target_is_directory=True)

            result = inventory.read_hardware_inventory(
                pci_root=str(pci),
                usb_root=str(usb),
                architecture="x86_64",
                kernel_abi="6.6.52-ordax",
            )

            self.assertEqual(result["schema"], "ordax.hardware-inventory/1")
            self.assertEqual(result["architecture"], "x86_64")
            self.assertEqual(result["kernelAbi"], "6.6.52-ordax")
            self.assertEqual(result["devices"], [{
                "id": "device-001",
                "bus": "pci",
                "modalias": "pci:v00008086d00002723",
                "driver": "iwlwifi",
            }])

    def test_missing_sysfs_bus_degrades_to_empty_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = inventory.read_hardware_inventory(
                pci_root=str(root / "missing-pci"),
                usb_root=str(root / "missing-usb"),
                architecture="x86_64",
                kernel_abi="6.6.52-ordax",
            )
            self.assertEqual(result["devices"], [])


if __name__ == "__main__":
    unittest.main()
