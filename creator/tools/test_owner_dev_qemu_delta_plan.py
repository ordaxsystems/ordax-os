"""Sparse COW extents must be bound to exact original physical partition."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ordax_cow_delta_test", HERE / "owner_dev_qemu_delta_plan.py",
)
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)
VOL = r"\\.\D:"
SIZE = 1024 * 1024


def map_fixture():
    return [
        {"start": 0, "length": 65536, "depth": 0,
         "present": True, "zero": False, "data": True,
         "compressed": False, "offset": 327680},
        {"start": 65536, "length": SIZE - 65536, "depth": 1,
         "present": True, "zero": False, "data": True,
         "compressed": False, "offset": 65536},
    ]


class DeltaPlanTests(unittest.TestCase):
    def test_changes_only_allocated_overlay_extents_not_raw_backing(self):
        extents = APP._segments(map_fixture(), SIZE)
        self.assertEqual(len(extents), 1)
        self.assertEqual(extents[0]["virtual_offset"], 0)
        self.assertEqual(extents[0]["length"], 65536)
        self.assertEqual(extents[0]["source_offset"], 327680)

    def test_rejects_gaps_bad_alignment_forged_depth_and_ambiguous_flags(self):
        scenarios = [
            [{"start": 512, "length": 65536, "depth": 0}],
            [{**map_fixture()[0], "start": 1024}, map_fixture()[1]],
            [{**map_fixture()[0], "length": 65535}, map_fixture()[1]],
            [{**map_fixture()[0], "compressed": True}, map_fixture()[1]],
            [{**map_fixture()[0], "data": False}, map_fixture()[1]],
            [{**map_fixture()[0], "offset": 17}, map_fixture()[1]],
            [{**map_fixture()[0], "depth": 2}, map_fixture()[1]],
            [{**map_fixture()[0], "present": 1}, map_fixture()[1]],
            [{**map_fixture()[0], "start": True}, map_fixture()[1]],
            [{**map_fixture()[0], "zero": True}, map_fixture()[1]],
            [map_fixture()[1]],
            [],
        ]
        for entries in scenarios:
            with self.subTest(entries=str(entries)[:60]):
                with self.assertRaises(APP.DeltaPlanError):
                    APP._segments(entries, SIZE)

    def test_zero_blocks_are_explicit_and_not_ignored(self):
        entries = map_fixture()
        entries[0] = {**entries[0], "zero": True, "data": False,
                      "present": False, "offset": None}
        modified = APP._segments(entries, SIZE)
        self.assertEqual(modified[0]["kind"], "zero")
        self.assertIsNone(modified[0]["source_offset"])

    def test_staged_postimage_and_original_preimage_are_hashed_without_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            overlay = Path(tmp) / "delta.qcow2"
            payload = bytearray(512 * 1024)
            payload[327680:327680 + 65536] = b"\x7f" * 65536
            overlay.write_bytes(payload)
            original = b"\x33" * SIZE
            info = {"format": "qcow2",
                    "backing-filename": VOL,
                    "backing-filename-format": "raw",
                    "virtual-size": SIZE}
            real_open = open
            def readonly_open(path, mode="r", *args, **kwargs):
                if path == VOL:
                    self.assertEqual(mode, "rb")
                    return io.BytesIO(original)
                return real_open(path, mode, *args, **kwargs)
            with mock.patch.object(APP, "_qemu_json",
                                   side_effect=lambda tool, op, img: info if op == "info" else map_fixture()), \
                 mock.patch("builtins.open", side_effect=readonly_open):
                plan = APP.compile_delta(
                    qemu_img=Path(tmp) / "qemu-img.exe", overlay=overlay,
                    volume=VOL, disk_number=1, usb_serial="6699E36B",
                    target_bytes=8053063680, partition_offset=269484032,
                    partition_bytes=SIZE)
            self.assertEqual(plan["region_count"], 1)
            self.assertEqual(plan["modified_bytes"], 65536)
            self.assertTrue(plan["physical_preimages_hashed"])
            self.assertTrue(plan["cow_postimages_hashed"])
            self.assertFalse(plan["physical_write"])
            self.assertFalse(plan["physical_write_authorized"])
            self.assertTrue(plan["requires_revalidation_under_writer_lock"])
            self.assertEqual(len(plan["plan_sha256"]), 64)

    def test_wrong_target_or_backing_fails_before_physical_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "shadow.qcow2"
            image.write_bytes(b"fixture")
            for volume, offset in ((r"\\.\C:", 269484032),
                                   (VOL, 0),
                                   (VOL, 8053063680)):
                with self.assertRaises(APP.DeltaPlanError):
                    APP.compile_delta(
                        qemu_img=Path("qemu-img"), overlay=image,
                        volume=volume, disk_number=1, usb_serial="6699E36B",
                        target_bytes=8053063680, partition_offset=offset,
                        partition_bytes=SIZE)
            with mock.patch.object(APP, "_qemu_json", return_value={
                "format": "qcow2", "backing-filename": r"\\.\PhysicalDrive0",
                "backing-filename-format": "raw", "virtual-size": SIZE,
            }):
                with self.assertRaisesRegex(APP.DeltaPlanError, "backing"):
                    APP.compile_delta(
                        qemu_img=Path("qemu-img"), overlay=image,
                        volume=VOL, disk_number=1, usb_serial="6699E36B",
                        target_bytes=8053063680, partition_offset=269484032,
                        partition_bytes=SIZE)


if __name__ == "__main__":
    unittest.main()
