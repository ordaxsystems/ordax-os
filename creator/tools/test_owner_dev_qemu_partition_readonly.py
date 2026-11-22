"""Unit regressions for the exact-identity, strictly read-only USB bridge."""
import io
import tempfile
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ordax_usb_readonly_test", HERE / "owner_dev_qemu_partition_readonly.py",
)
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


def fixture():
    return {
        "Number": 1, "Serial": "6699E36B", "BusType": "USB",
        "IsBoot": False, "IsSystem": False, "Size": 8053063680,
        "Partitions": [
            {"Number": 1, "Letter": "", "Type": "System",
             "Offset": 1048576, "Size": 268435456},
            {"Number": 2, "Letter": "D", "Type": "Unknown",
             "Offset": 269484032, "Size": 6708789248},
            {"Number": 3, "Letter": "E", "Type": "Basic",
             "Offset": 6978273280, "Size": 1074773504},
        ],
    }


class ReadonlyPhysicalUSBTests(unittest.TestCase):
    def test_selected_real_owner_media_is_bound_to_disk_and_serial(self):
        self.assertEqual(APP.confirmed_volume(fixture(), 1, "6699e36b"), "D")

    def test_wrong_serial_system_disk_or_layout_fails_closed(self):
        f = fixture()
        with self.assertRaises(APP.ReadonlyProbeError):
            APP.confirmed_volume(f, 1, "WRONGSERIAL")
        for field, changed in (
            ("BusType", "SATA"), ("IsBoot", True), ("IsSystem", True),
            ("Number", 0), ("Serial", "SWAPPED"), ("Partitions", []),
            ("Size", "8GB"),
        ):
            value = fixture()
            value[field] = changed
            with self.subTest(field=field):
                with self.assertRaises(APP.ReadonlyProbeError):
                    APP.confirmed_volume(value, 1, "6699E36B")

    def test_unknown_or_overlapping_partitions_cannot_be_read(self):
        for key, changed in (
            ("Letter", "C"), ("Letter", ""), ("Size", 8),
            ("Offset", 100), ("Type", "Basic"),
        ):
            value = fixture()
            value["Partitions"][1][key] = changed
            with self.subTest(key=key):
                with self.assertRaises(APP.ReadonlyProbeError):
                    APP.confirmed_volume(value, 1, "6699E36B")

    def test_read_only_guest_never_formats_or_writes(self):
        script = APP.guest_script()
        self.assertIn("mount -t ext4 -o ro,noload /dev/vda /mnt", script)
        self.assertIn("umount /mnt", script)
        for command in ("mkfs", "mke2fs", "tar -x", "dd ", "rm -", "> /mnt"):
            self.assertNotIn(command, script)

    def test_superblock_is_read_only_and_validated(self):
        block = bytearray(2048)
        block[1024 + 56:1024 + 58] = b"\x53\xef"
        with mock.patch("builtins.open", return_value=io.BytesIO(block)) as opened:
            APP.verify_superblock("D")
        self.assertEqual(opened.call_args.args[1], "rb")
        block[1024 + 56:1024 + 58] = b"\x00\x00"
        with mock.patch("builtins.open", return_value=io.BytesIO(block)):
            with self.assertRaisesRegex(APP.ReadonlyProbeError, "no ext-family"):
                APP.verify_superblock("D")

    def test_published_manifest_mismatch_blocks_before_qemu(self):
        with tempfile.TemporaryDirectory() as root:
            candidate = Path(root) / ("a" * 40)
            candidate.mkdir()
            (candidate / "dev-base.json").write_bytes(b"local-not-published")
            owner = mock.Mock()
            channel = owner.channel_owner.return_value
            channel.verify_materialized.return_value = {"kernel": {"sha256": "b" * 64}}
            channel.resolve_published_source.return_value = (
                candidate.name, b"different-canonical-manifest",
            )
            with (
                mock.patch.object(APP, "inventory", return_value=fixture()),
                mock.patch.object(APP, "verify_superblock"),
                mock.patch.object(APP, "proof_owner", return_value=owner),
                mock.patch.object(APP.tarfile, "open") as tar_open,
            ):
                with self.assertRaisesRegex(
                    APP.ReadonlyProbeError, "published Git authority",
                ):
                    APP.probe(
                        candidate, Path(root) / "qemu.exe", disk_number=1,
                        serial="6699E36B", requested_commit="a" * 40,
                    )
                tar_open.assert_not_called()

    def test_inventory_rejects_invalid_disk_number_before_shell(self):
        with mock.patch.object(APP.subprocess, "run") as run:
            for number in (-1, 1000, True):
                with self.assertRaises(APP.ReadonlyProbeError):
                    APP.inventory(number)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
