#!/usr/bin/env python3
"""Portable v2 disposable workflows consume the exact independent Creator Core."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/portable-usb-v2-proof.yml"
CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


class PortableExternalCreatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = WORKFLOW.read_text(encoding="utf-8")
        cls.pin = json.loads(CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_single_immutable_source_and_no_embedded_core_invocation(self):
        w = self.w
        self.assertEqual(self.pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.pin["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertFalse(self.pin["physical_apply_authorized"])
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn('git -C "$creator" rev-parse HEAD', w)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn("ORDAX_OS_CONTRACTS_DIR=", w)
        self.assertIn('"$creator_cli" plan-portable --target-bytes "$target_bytes"', w)
        self.assertIn('"$creator_cli" bind-portable-sources --sources-root "$fixtures"', w)
        self.assertIn('"$creator_cli" verify-portable-sources', w)
        self.assertIn('"$creator_cli" plan-portable-media', w)
        self.assertIn('"$creator_cli" plan-portable-application', w)
        self.assertNotIn("cd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)
        self.assertNotIn("import hashlib, json, pathlib", w)
        self.assertEqual(w.count("systemd-boot loader-config loader-normal"), 0)
        self.assertIn('mapfile -t source_ids < "$root/source-ids.txt"', w)

    def test_only_disposable_os_proof_retained_and_no_physical_authority(self):
        w = self.w
        self.assertIn("tools/creator/proof/portable_prepared_media.py", w)
        self.assertIn("tools/creator/proof/portable_usb_v2.py", w)
        self.assertIn("PHYSICAL_TARGET_DEVICE_TOUCHED=NO", w)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", w)
        self.assertIn("PORTABLE_USB_V2_RAW_RETAINED=NO", w)
        self.assertIn("PORTABLE_USB_V2_PROOF_METADATA_ONLY=YES", w)
        self.assertIn('test ! -e "$root/portable-prepared.raw"', w)
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("contents: write", w)
        self.assertNotIn("gh release", w)


if __name__ == "__main__":
    unittest.main()
