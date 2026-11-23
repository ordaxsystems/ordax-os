"""Exact-hash disposable payload bundle regressions; never open physical USB."""
from __future__ import annotations

import hashlib
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "ordax_delta_bundle_test", HERE / "owner_dev_qemu_delta_bundle.py",
)
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)

BASE = "9" * 40
MAIN = "d" * 40
SERIAL = "6699E36B"
PHYSICAL = 8053063680
OFFSET = 269484032
PARTITION = 6708789248
CHANGED = 65536


def fixture_delta(changes: list[dict]) -> dict:
    proof = {
        "$schema": MODULE.PLAN_SCHEMA,
        "disk_number": 1,
        "usb_serial": SERIAL,
        "physical_size_bytes": PHYSICAL,
        "partition_start_bytes": OFFSET,
        "partition_size_bytes": PARTITION,
        "regions": changes,
    }
    fingerprint = hashlib.sha256(
        json.dumps(proof, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "$schema": MODULE.PLAN_SCHEMA,
        "status": "verified-readonly-delta-plan",
        "disk_number": 1, "usb_serial": SERIAL,
        "physical_write": False, "physical_write_authorized": False,
        "apply_executed": False,
        "physical_preimages_hashed": True,
        "cow_postimages_hashed": True,
        "region_count": len(changes),
        "modified_bytes": sum(c["length_bytes"] for c in changes),
        "regions": changes,
        "plan_sha256": fingerprint,
    }


def data_region(offset=0, length=CHANGED, local=327680):
    return {
        "kind": "data",
        "disk_offset_bytes": OFFSET + offset,
        "virtual_offset_bytes": offset,
        "length_bytes": length,
        "overlay_source_offset_bytes": local,
        "preimage_sha256": hashlib.sha256(bytes([0x33]) * length).hexdigest(),
        "postimage_sha256": hashlib.sha256(bytes([0x7f]) * length).hexdigest(),
    }


class DeltaBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "cache"
        self.overlay = self.root / "shadow.qcow2"
        contents = bytearray(512 * 1024)
        contents[327680:327680 + CHANGED] = bytes([0x7f]) * CHANGED
        self.overlay.write_bytes(contents)
        self.delta = fixture_delta([data_region()])

    def prepare(self, *, delta=None):
        return MODULE.prepare_bundle(
            delta=self.delta if delta is None else delta,
            overlay=self.overlay,
            cache_root=self.cache,
            disk_number=1, serial=SERIAL, disk_bytes=PHYSICAL,
            partition_offset=OFFSET, partition_bytes=PARTITION,
            requested_main_commit=MAIN,
            published_base_source_commit=BASE,
        )

    def test_materializes_verified_local_bytes_and_reuses_immutable_plan(self):
        receipt = self.prepare()
        self.assertFalse(receipt["physical_write"])
        self.assertFalse(receipt["physical_write_authorized"])
        self.assertFalse(receipt["activation_performed"])
        self.assertEqual(receipt["payload_bytes"], CHANGED)
        self.assertEqual(receipt["region_count"], 1)
        self.assertFalse(receipt["cache_reused"])
        bundle = Path(receipt["bundle_path"])
        self.assertEqual((bundle / "delta.bin").read_bytes(), bytes([0x7f]) * CHANGED)
        manifest = MODULE.verify_bundle(bundle)
        self.assertEqual(manifest["regions"][0]["disk_offset_bytes"], OFFSET)
        self.assertEqual(manifest["regions"][0]["payload_offset_bytes"], 0)
        self.assertNotIn("overlay_source_offset_bytes", manifest["regions"][0])
        self.assertEqual(manifest["status"], "prepared-not-authorized")
        second = self.prepare()
        self.assertEqual(second["bundle_path"], receipt["bundle_path"])
        self.assertTrue(second["cache_reused"])
        self.assertEqual(second["manifest_sha256"], receipt["manifest_sha256"])

    def test_cached_package_must_match_exact_published_base_commit(self):
        self.prepare()
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "conflicts"):
            MODULE.prepare_bundle(
                delta=self.delta, overlay=self.overlay, cache_root=self.cache,
                disk_number=1, serial=SERIAL, disk_bytes=PHYSICAL,
                partition_offset=OFFSET, partition_bytes=PARTITION,
                requested_main_commit=MAIN, published_base_source_commit="8" * 40,
            )

    def test_rejects_mutated_or_missing_cached_payload_instead_of_reusing(self):
        receipt = self.prepare()
        bundle = Path(receipt["bundle_path"])
        with (bundle / "delta.bin").open("r+b") as file:
            file.write(b"\x00")
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "checksum"):
            MODULE.verify_bundle(bundle)
        with self.assertRaises(MODULE.DeltaBundleError):
            self.prepare()
        self.assertEqual(len(list(self.cache.glob(".ordax-delta-pending-*"))), 0)

    def test_rejects_postimage_digest_mismatch_without_leaking_temp(self):
        changed = data_region()
        changed["postimage_sha256"] = "b" * 64
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "postimage"):
            self.prepare(delta=fixture_delta([changed]))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_rejects_target_rebind_and_overlapping_extents(self):
        invalid = data_region()
        invalid["disk_offset_bytes"] = OFFSET - CHANGED
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "escaped"):
            self.prepare(delta=fixture_delta([invalid]))
        a = data_region()
        b = data_region(offset=CHANGED // 2)
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "unsorted"):
            self.prepare(delta=fixture_delta([a, b]))
        with self.assertRaises(MODULE.DeltaBundleError):
            MODULE.prepare_bundle(
                delta=self.delta, overlay=self.overlay,
                cache_root=self.cache, disk_number=0,
                serial=SERIAL, disk_bytes=PHYSICAL,
                partition_offset=OFFSET, partition_bytes=PARTITION,
                requested_main_commit=MAIN, published_base_source_commit=BASE,
            )

    def test_zero_regions_use_explicit_zero_bytes_not_cow_data(self):
        zero = data_region()
        zero["kind"] = "zero"
        zero["overlay_source_offset_bytes"] = None
        zero["postimage_sha256"] = hashlib.sha256(bytes(CHANGED)).hexdigest()
        receipt = self.prepare(delta=fixture_delta([zero]))
        payload = Path(receipt["bundle_path"]) / "delta.bin"
        self.assertEqual(payload.read_bytes(), bytes(CHANGED))
        self.assertEqual(MODULE.verify_bundle(payload.parent)["payload_bytes"], CHANGED)

    def test_rejects_manifest_tampering_even_with_payload_still_intact(self):
        receipt = self.prepare()
        path = Path(receipt["bundle_path"]) / "manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["activation_performed"] = True
        path.write_bytes(MODULE.canonical_json(manifest))
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "receipt policy"):
            MODULE.verify_bundle(path.parent)

    def test_cached_preimage_check_reads_only_current_usb_and_rejects_drift(self):
        receipt = self.prepare()
        package = Path(receipt["bundle_path"])
        args = dict(directory=package, volume=chr(92) * 2 + "." + chr(92) + "D:",
                    disk_number=1, serial=SERIAL, disk_bytes=PHYSICAL,
                    partition_offset=OFFSET, partition_bytes=PARTITION)
        with mock.patch("builtins.open", return_value=io.BytesIO(bytes([0x33]) * CHANGED)) as source:
            result = MODULE.verify_physical_preimages(**args)
        self.assertEqual(result["status"], "cached-preimages-still-match")
        self.assertEqual(result["verified_regions"], 1)
        self.assertEqual(result["verified_bytes"], CHANGED)
        self.assertFalse(result["writer_lock_held"])
        self.assertFalse(result["physical_write"])
        self.assertEqual(source.call_args.args[1], "rb")

        with mock.patch("builtins.open", return_value=io.BytesIO(bytes(CHANGED))):
            with self.assertRaisesRegex(MODULE.DeltaBundleError, "stale"):
                MODULE.verify_physical_preimages(**args)
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "target"):
            MODULE.verify_physical_preimages(**{**args, "serial": "SWAPPED"})
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "volume"):
            MODULE.verify_physical_preimages(
                **{**args, "volume": chr(92) * 2 + "." + chr(92) + "C:"}
            )

    def test_rejects_invalid_source_revision_or_plan_digest(self):
        fake = dict(self.delta)
        fake["plan_sha256"] = "a" * 64
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "fingerprint"):
            self.prepare(delta=fake)
        with self.assertRaisesRegex(MODULE.DeltaBundleError, "candidate"):
            MODULE.prepare_bundle(
                delta=self.delta, overlay=self.overlay,
                cache_root=self.cache, disk_number=1, serial=SERIAL,
                disk_bytes=PHYSICAL, partition_offset=OFFSET,
                partition_bytes=PARTITION, requested_main_commit="not-a-commit",
                published_base_source_commit=BASE,
            )


if __name__ == "__main__":
    unittest.main()
