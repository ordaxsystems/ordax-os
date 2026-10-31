#!/usr/bin/env python3
"""Native disposable-media planning stays on one verified independent Creator Core."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/native-disposable-storage-proof.yml"
CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


class NativeDisposableCreatorSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = WORKFLOW.read_text(encoding="utf-8")
        cls.pin = json.loads(CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_one_pinned_cli_from_owner_repo(self):
        w = self.w
        self.assertEqual(self.pin["repository"], "ordaxsystems/ordax-creator")
        self.assertFalse(self.pin["physical_apply_authorized"])
        self.assertEqual(self.pin["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn('git -C "$creator" rev-parse HEAD', w)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn("ORDAX_OS_CONTRACTS_DIR=", w)
        self.assertIn('"$creator" plan-native-materialization', w)
        self.assertNotIn("cd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)

    def test_native_disposable_python_producer_remains_in_os(self):
        w = self.w
        self.assertIn("python3 tools/creator/proof/native_disposable.py", w)
        self.assertIn("--contract docs/contracts/native-disposable-proof.json", w)
        self.assertIn("plan['physical_write_allowed'] is False", w)
        self.assertIn("proof['physical_device_touched'] is False", w)
        self.assertIn("NATIVE_PHYSICAL_WRITE_AUTHORIZED=NO", w)
        self.assertIn("NATIVE_LUKS_KEY_RETAINED=NO", w)
        self.assertIn("NATIVE_DISPOSABLE_RAW_RETAINED=NO", w)
        self.assertIn("NATIVE_PROOF_METADATA_ONLY=YES", w)
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("contents: write", w)
        self.assertNotIn("gh release", w)


if __name__ == "__main__":
    unittest.main()
