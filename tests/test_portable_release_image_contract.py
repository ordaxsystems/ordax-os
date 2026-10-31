#!/usr/bin/env python3
"""Regression tests for the portable USB v2 EROFS release candidate boundary."""

from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs/contracts/portable-release-image.json"
BUILDER = ROOT / "tools/portable-release-image/build.py"
PROTOCOL = ROOT / "docs/contracts/release-protocol.json"

spec = importlib.util.spec_from_file_location("ordax_portable_release_image", BUILDER)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class PortableReleaseImageContractTests(unittest.TestCase):
    def load_contract(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def make_tar(self, root: Path, *, entrypoint_mode: int = 0o755, mtime: int = 0) -> Path:
        path = root / "system.tar"
        with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as archive:
            directory = tarfile.TarInfo("system")
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            directory.uid = directory.gid = 0
            directory.uname = directory.gname = ""
            directory.mtime = mtime
            archive.addfile(directory)

            payload = b"#!/bin/sh\nexit 0\n"
            entrypoint = tarfile.TarInfo("system/entrypoint")
            entrypoint.mode = entrypoint_mode
            entrypoint.uid = entrypoint.gid = 0
            entrypoint.uname = entrypoint.gname = ""
            entrypoint.mtime = mtime
            entrypoint.size = len(payload)
            archive.addfile(entrypoint, io.BytesIO(payload))
        return path

    def test_contract_keeps_release_protocol_v1_immutable(self):
        contract = self.load_contract()
        protocol = json.loads(PROTOCOL.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.portable-release-image/1")
        self.assertEqual(contract["status"], "candidate-proof-only")
        self.assertTrue(
            contract["source_artifact"]["release_protocol_v1_signed_artifact_unchanged"]
        )
        self.assertFalse(contract["integration"]["release_protocol_v1_changed"])
        self.assertTrue(contract["integration"]["manifest_v2_implemented"])
        self.assertTrue(contract["integration"]["signer_v2_implemented"])
        self.assertTrue(contract["integration"]["acquisition_agent_v2_implemented"])
        self.assertTrue(contract["integration"]["portable_materialization_implemented"])
        self.assertFalse(contract["integration"]["portable_activation_implemented"])
        self.assertFalse(contract["integration"]["portable_boot_handoff_connected"])
        self.assertFalse(contract["integration"]["public_signed_publication_enabled"])
        self.assertFalse(contract["integration"]["physical_write_authorized"])
        self.assertEqual(protocol["current"]["manifest_v1"]["artifact_name"], "system.tar")
        self.assertEqual(protocol["current"]["manifest_v1"]["artifact_role"], "system")
        self.assertEqual(
            protocol["portable_v2"]["manifest_schema"],
            "prototype-ordax.release-manifest/2",
        )
        self.assertTrue(protocol["portable_v2"]["materialization_support"])
        self.assertFalse(protocol["portable_v2"]["activation_support"])

    def test_image_policy_is_deterministic_and_read_only(self):
        output = self.load_contract()["output"]
        self.assertEqual(output["name"], "system.erofs")
        self.assertEqual(output["filesystem"], "erofs")
        self.assertEqual(output["volume_label"], "ORDAX-SYSTEM")
        self.assertEqual(
            output["filesystem_uuid_policy"],
            "uuidv5-fixed-namespace-over-system-tar-sha256",
        )
        first = module.deterministic_image_uuid("a" * 64)
        second = module.deterministic_image_uuid("a" * 64)
        different = module.deterministic_image_uuid("b" * 64)
        self.assertEqual(first, second)
        self.assertNotEqual(first, different)
        self.assertEqual(output["timestamp"], 0)
        self.assertEqual(output["compression"], "lz4")
        self.assertTrue(output["read_only"])
        self.assertTrue(output["byte_reproducible_required"])

    def test_builder_accepts_only_normalized_release_bundle_tar(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            good = self.make_tar(root)
            result = module.validate_tar(good)
            self.assertEqual(result["entry_count"], 2)
            self.assertGreater(result["size"], 0)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad_mode = self.make_tar(root, entrypoint_mode=0o644)
            with self.assertRaisesRegex(module.ImageError, "entrypoint"):
                module.validate_tar(bad_mode)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad_time = self.make_tar(root, mtime=1)
            with self.assertRaisesRegex(module.ImageError, "timestamp"):
                module.validate_tar(bad_time)

    def test_builder_never_signs_publishes_or_authorizes_media(self):
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn('"release_protocol_v1_changed": False', text)
        self.assertIn('"signed_publication_enabled": False', text)
        self.assertIn('"physical_write_authorized": False', text)
        self.assertNotIn("release-signing", text)
        self.assertNotIn("PhysicalDrive", text)


    def test_candidate_erofs_uses_verified_external_intelligence_only(self):
        contract = self.load_contract()
        source = contract["external_intelligence_candidate"]
        self.assertEqual(source["owner"], "ordaxsystems/ordax-intelligence")
        self.assertEqual(source["lock"], "docs/contracts/intelligence-source.json")
        self.assertTrue(source["required_in_portable_v2_ci"])
        self.assertFalse(source["legacy_engine_source_in_image_allowed"])
        self.assertFalse(source["device_activation_authorized"])
        workflow = (ROOT / ".github/workflows/portable-release-image.yml").read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/actions/assemble-intelligence", workflow)
        self.assertIn("--root \"$RUNNER_TEMP/ordax-assembled-intelligence\"", workflow)
        self.assertIn("PORTABLE_EROFS_INTELLIGENCE_CANONICAL=PASS", workflow)

if __name__ == "__main__":
    unittest.main()
