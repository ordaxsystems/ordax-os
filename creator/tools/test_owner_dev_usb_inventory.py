"""USB discovery is read-only and reuses the physical Owner DEV validator."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "usb_inventory_test", HERE / "owner_dev_usb_inventory.py",
)
import sys
sys.path.insert(0, str(HERE))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def sample():
    return {"Number": 1, "Serial": "6699E36B", "BusType": "USB",
            "IsBoot": False, "IsSystem": False, "Size": 8053063680,
            "Partitions": [
                {"Number": 1, "Letter": "", "Type": "System", "Offset": 1048576, "Size": 268435456},
                {"Number": 2, "Letter": "D", "Type": "Unknown", "Offset": 269484032, "Size": 6708789248},
                {"Number": 3, "Letter": "E", "Type": "Basic", "Offset": 6978273280, "Size": 1074773504},
            ]}


class USBMediaInventoryTests(unittest.TestCase):
    def test_physical_media_inspection_is_read_only_and_reports_unknown_version(self):
        with mock.patch.object(MOD, "inventory", return_value=sample()), \
             mock.patch.object(MOD, "verify_superblock") as sb:
            result = MOD.inspect(1, "6699E36B")
        self.assertEqual(result["status"], "recognized")
        self.assertEqual(result["usb_serial"], "6699E36B")
        self.assertEqual(result["installed_os_revision"], None)
        self.assertFalse(result["installed_revision_proven"])
        self.assertFalse(result["physical_write"])
        self.assertFalse(result["physical_write_authorized"])
        sb.assert_called_once_with("D")

    def test_mismatch_and_hot_swap_fail_closed(self):
        with mock.patch.object(MOD, "inventory", return_value=sample()):
            with self.assertRaises(MOD.ReadonlyProbeError):
                MOD.inspect(1, "UNTRUSTEDSERIAL")
        altered = sample()
        altered["Serial"] = "CHANGED"
        with mock.patch.object(MOD, "inventory", side_effect=[sample(), altered]), \
             mock.patch.object(MOD, "verify_superblock"):
            with self.assertRaisesRegex(MOD.ReadonlyProbeError, "changed"):
                MOD.inspect(1, "6699E36B")

    def test_list_filters_unrecognized_disks_without_treating_as_empty_on_enumeration_error(self):
        with mock.patch.object(MOD, "eligible_numbers", return_value=[1, 2]), \
             mock.patch.object(MOD, "inventory", side_effect=lambda n: sample() if n == 1 else None), \
             mock.patch.object(MOD, "inspect", side_effect=lambda n, serial: {"disk_number": 1} if n == 1 else (_ for _ in ()).throw(MOD.ReadonlyProbeError("not OrdaX"))):
            result = MOD.list_media()
        self.assertEqual(result["device_count"], 1)
        self.assertEqual(result["devices"], [{"disk_number": 1}])
        with mock.patch.object(MOD, "eligible_numbers", side_effect=MOD.ReadonlyProbeError("no inventory")):
            with self.assertRaises(MOD.ReadonlyProbeError):
                MOD.list_media()

    def test_no_user_supplied_paths_or_unknown_fields(self):
        with self.assertRaises(MOD.ReadonlyProbeError):
            MOD.inspect(-1, "6699E36B")
        with self.assertRaises(MOD.ReadonlyProbeError):
            MOD.inspect(1, "../unsafe")

    def test_enumeration_rejects_duplicate_or_invalid_numbers(self):
        def result(obj):
            import json
            return mock.Mock(returncode=0, stdout=json.dumps(obj).encode("utf-8"))
        for value in ([1, 1], [True], [-1], list(range(33)), "disk"):
            with self.subTest(value=str(value)[:20]):
                with mock.patch.object(MOD.subprocess, "run", return_value=result(value)):
                    with self.assertRaises(MOD.ReadonlyProbeError):
                        MOD.eligible_numbers()


if __name__ == "__main__":
    unittest.main()
