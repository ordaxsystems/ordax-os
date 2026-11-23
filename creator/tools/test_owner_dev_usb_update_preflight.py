"""Safety and authority checks for the host-only Owner DEV update preflight."""
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location(
    "owner_usb_update_preflight_test", HERE / "owner_dev_usb_update_preflight.py",
)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

SOURCE = "f" * 40
BASE = "a" * 40
SERIAL = "6699E36B"


def media():
    return {
        "Number": 1, "Serial": SERIAL, "BusType": "USB",
        "IsBoot": False, "IsSystem": False, "Size": 8053063680,
        "Partitions": [
            {"Number": 1, "Letter": "", "Type": "System", "Offset": 1048576, "Size": 268435456},
            {"Number": 2, "Letter": "D", "Type": "Unknown", "Offset": 269484032, "Size": 6708789248},
            {"Number": 3, "Letter": "E", "Type": "Basic", "Offset": 6978273280, "Size": 1074773504},
        ],
    }


def good_evidence():
    return {
        "status": "pass", "physical_usb_write": False,
        "physical_write_authorized": False,
        "source_commit": BASE, "requested_source_commit": SOURCE,
        "usb_serial": SERIAL, "disk_number": 1,
        "guest_stage_verified": True, "cold_readback_verified": True,
        "physical_absence_verified": True, "physical_sample_sha256_unchanged": True,
        "purpose": "filesystem-proof-only",
        "installable_candidate": False,
        "canonical_inactive_slot_staged": False,
        "cow_physical_preimages_hashed": True, "cow_postimages_hashed": True,
        "cow_modified_bytes": 65536, "cow_modified_regions": 1,
        "cow_delta_plan_sha256": "b" * 64,
    }


class USBUpdatePreflightTests(unittest.TestCase):
    def setUp(self):
        self.real_verify_data_label = MOD._verify_data_label
        self.real_base_directory = MOD._base_directory
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / BASE
        self.base.mkdir()
        (self.base / "dev-base.json").write_bytes(b"publisher-bytes")
        self.channel = SimpleNamespace(
            DevBaseChannelError=ValueError,
            resolve_published_source=lambda *args, **kwargs: (BASE, b"publisher-bytes"),
            verify_materialized=lambda *args: {},
        )
        self.patches = [
            mock.patch.object(MOD, "inventory", return_value=media()),
            mock.patch.object(MOD, "confirmed_volume", return_value="D"),
            mock.patch.object(MOD, "verify_superblock"),
            mock.patch.object(MOD, "_verify_data_label"),
            mock.patch.object(MOD, "_real_directory", return_value=True),
            mock.patch.object(MOD, "_real_regular", return_value=True),
            mock.patch.object(MOD, "_current_source", return_value=SOURCE),
            mock.patch.object(MOD, "_channel", return_value=self.channel),
            mock.patch.object(MOD, "_base_directory", return_value=self.base),
            mock.patch.object(MOD, "prove", return_value=good_evidence()),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_success_reports_only_disposable_feasibility_not_installed_or_write(self):
        result = MOD.preflight(1, SERIAL)
        self.assertEqual(result["status"], "verified-offline-candidate-feasibility")
        self.assertEqual(result["requested_main_commit"], SOURCE)
        self.assertEqual(result["published_base_source_commit"], BASE)
        for field in ("physical_write", "physical_write_authorized",
                      "update_executed", "installed_revision_proven",
                      "activation_performed"):
            self.assertIs(result[field], False, field)
        self.assertIs(result["rootfs_cow_stage_verified"], True)

    def test_supervisor_progress_is_advisory_and_cannot_claim_physical_write(self):
        phases = []
        receipt = MOD.preflight(1, SERIAL, progress=phases.append)
        self.assertEqual(phases, [
            "physical-target-inventory", "resolving-published-base",
            "published-base-verified", "physical-media-unchanged",
        ])
        self.assertFalse(receipt["update_executed"])
        self.assertFalse(receipt["physical_write"])

    def test_optional_local_bundle_is_bound_to_the_exact_guest_proof(self):
        import os
        local = Path(self.temp.name)
        cache = local / "OrdaX" / "updates" / "creator" / "dev-delta"
        bundle_path = cache / "test-verified-bundle"
        bundle_path.mkdir(parents=True)
        (bundle_path / "manifest.json").write_text("canonical", encoding="utf-8")
        staged = {
            "bundle_path": str(bundle_path),
            "requested_main_commit": SOURCE,
            "usb_serial": SERIAL,
            "cow_plan_sha256": "b" * 64,
            "manifest_sha256": "a" * 64,
            "region_count": 1, "payload_bytes": 65536,
            "physical_write": False,
            "physical_write_authorized": False,
        }
        guest = {**good_evidence(), "host_delta_bundle": staged}
        bundle_owner = SimpleNamespace(
            DeltaBundleError=ValueError,
            verify_bundle=lambda path: {
                "cow_plan_sha256": "b" * 64,
                "requested_main_commit": SOURCE,
                "target": {"usb_serial": SERIAL},
            },
            _hash_file=lambda path: "a" * 64,
        )
        with (mock.patch.object(MOD, "prove", return_value=guest),
              mock.patch.object(MOD, "_load_bundle", return_value=bundle_owner),
              mock.patch.dict(os.environ, {"LOCALAPPDATA": str(local)})):
            result = MOD.preflight(1, SERIAL, prepare_host_bundle=True)
            self.assertEqual(result["host_delta_bundle"], staged)
            self.assertFalse(result["physical_write"])
            with mock.patch.object(MOD, "prove", return_value={
                **guest,
                "host_delta_bundle": {**staged, "physical_write_authorized": True},
            }):
                with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "disagrees"):
                    MOD.preflight(1, SERIAL, prepare_host_bundle=True)

    def test_reuse_cached_bundle_checks_source_and_preimages_without_qemu(self):
        import os
        cache = (Path(self.temp.name) / "OrdaX" / "updates" /
                 "creator" / "dev-delta")
        package = cache / ("c0db578e6939be40-" + SERIAL + "-verified")
        package.mkdir(parents=True)
        current = media()
        target = {
            "disk_number": 1, "usb_serial": SERIAL,
            "physical_size_bytes": current["Size"], "partition_number": 2,
            "partition_offset_bytes": current["Partitions"][1]["Offset"],
            "partition_bytes": current["Partitions"][1]["Size"],
        }
        manifest = {
            "requested_main_commit": "0" * 40,
            "published_base_source_commit": BASE,
            "target": target,
        }
        proof = {
            "bundle_manifest_sha256": "f" * 64,
            "verified_regions": 136, "verified_bytes": 204537856,
            "physical_write": False, "writer_lock_held": False,
        }
        candidate = SimpleNamespace(
            DeltaBundleError=ValueError,
            verify_bundle=lambda location: manifest,
            verify_physical_preimages=lambda location, **kwargs: proof,
        )
        channel = SimpleNamespace(
            DevBaseChannelError=ValueError,
            resolve_published_source=lambda *args, **kwargs: (
                BASE, b"publisher-bytes",
            ),
            verify_materialized=lambda *args: {},
            prove_compatible_source=lambda *args, **kwargs: True,
        )
        with (mock.patch.object(MOD, "_channel", return_value=channel),
              mock.patch.object(MOD, "_load_bundle", return_value=candidate),
              mock.patch.object(MOD, "prove") as qemu,
              mock.patch.dict(os.environ, {"LOCALAPPDATA": self.temp.name})):
            result = MOD.preflight(1, SERIAL, reuse_host_bundle=True)
            self.assertEqual(result["status"],
                             "verified-cached-host-delta-preimages")
            self.assertEqual(result["verified_regions"], 136)
            self.assertFalse(result["physical_write"])
            self.assertFalse(result["writer_lock_held"])
            qemu.assert_not_called()
            channel.prove_compatible_source = lambda *args, **kwargs: False
            with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "no compatible"):
                MOD.preflight(1, SERIAL, reuse_host_bundle=True)
            qemu.assert_not_called()

    def test_cached_manifest_uses_exact_publisher_bytes(self):
        (self.base / "dev-base.json").write_bytes(b"modified")
        with mock.patch.object(MOD, "prove") as guest:
            with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "differs"):
                MOD.preflight(1, SERIAL)
            guest.assert_not_called()

    def test_untrusted_guest_receipt_and_identity_fail_closed(self):
        for mutate in (
            {"status": "error"}, {"physical_usb_write": True},
            {"physical_write_authorized": True}, {"guest_stage_verified": False},
            {"cold_readback_verified": False}, {"physical_absence_verified": False},
            {"source_commit": SOURCE}, {"requested_source_commit": BASE},
            {"usb_serial": "SWAPPED"}, {"disk_number": 2},
            {"physical_sample_sha256_unchanged": False},
            {"cow_physical_preimages_hashed": False},
            {"cow_postimages_hashed": False},
            {"cow_modified_regions": 0}, {"cow_modified_bytes": 0},
            {"cow_delta_plan_sha256": "untrusted"},
            {"purpose": "installed"},
            {"installable_candidate": True},
            {"canonical_inactive_slot_staged": True},
        ):
            with self.subTest(mutate=mutate):
                evidence = {**good_evidence(), **mutate}
                with mock.patch.object(MOD, "prove", return_value=evidence):
                    with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "did not bind"):
                        MOD.preflight(1, SERIAL)

    def test_media_disappeared_after_guest_stage(self):
        changed = media()
        changed["Serial"] = "OTHER"
        with mock.patch.object(MOD, "inventory", side_effect=[media(), media(), changed]):
            with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "changed"):
                MOD.preflight(1, SERIAL)

    def test_no_published_base_rejects_before_qemu(self):
        bad = SimpleNamespace(
            DevBaseChannelError=ValueError,
            resolve_published_source=mock.Mock(side_effect=ValueError("no Base")),
        )
        with mock.patch.object(MOD, "_channel", return_value=bad):
            with mock.patch.object(MOD, "prove") as guest:
                with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "no compatible"):
                    MOD.preflight(1, SERIAL)
                guest.assert_not_called()

    def test_data_filesystem_is_required(self):
        valid = SimpleNamespace(returncode=0,
                                stdout=b'{"label":"ORDAX-DATA","filesystem":"exFAT"}')
        invalid = SimpleNamespace(returncode=0,
                                  stdout=b'{"label":"MISMATCH","filesystem":"NTFS"}')
        with mock.patch.object(MOD.subprocess, "run", return_value=valid):
            self.real_verify_data_label("E")
        with mock.patch.object(MOD.subprocess, "run", return_value=invalid):
            with self.assertRaisesRegex(MOD.USBUpdatePreflightError, "does not match"):
                self.real_verify_data_label("E")
        with self.assertRaises(MOD.USBUpdatePreflightError):
            self.real_verify_data_label("C")

    def test_paths_are_selected_from_media_not_from_external_argument(self):
        candidate = self.real_base_directory("E", BASE)
        self.assertEqual(candidate, Path("E:\\.ordax\\updates\\owner-base") / BASE)
        self.assertEqual(MOD.preflight.__code__.co_argcount, 2)
        with self.assertRaises(MOD.USBUpdatePreflightError):
            MOD._data_volume_letter({
                **media(), "Partitions": [{}, {"Letter": "D"}, {"Letter": "C"}],
            })


if __name__ == "__main__":
    unittest.main()
