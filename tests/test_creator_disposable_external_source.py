#!/usr/bin/env python3
"""The OS owns disposable-media generation; independent Creator owns Go staging."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
W = ROOT / ".github/workflows/creator-disposable-media.yml"
LOCK = ROOT / "docs/contracts/native-release-assembly.json"


class CreatorDisposableExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = W.read_text(encoding="utf-8")
        cls.source = json.loads(LOCK.read_text(encoding="utf-8"))["creator_source"]

    def test_exact_one_pinned_implementation_and_read_only_cli(self):
        w = self.workflow
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertFalse(self.source["physical_apply_authorized"])
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn('ORDAX_OS_CONTRACTS_DIR="$GITHUB_WORKSPACE/docs/contracts"', w)
        self.assertIn('go test -count=1 ./core ./cmd/ordax-creator', w)
        self.assertIn('creator="$RUNNER_TEMP/creator-disposable-cli"', w)
        self.assertNotIn("pushd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)

    def test_os_disposable_producer_and_physical_safety_unchanged(self):
        w = self.workflow
        self.assertIn("python tools/creator/proof/disposable_media.py", w)
        self.assertIn("--contract docs/contracts/physical-media.json", w)
        self.assertIn("PHYSICAL_WRITE_STATUS=blocked", w)
        self.assertIn("GPT_FILESYSTEM_PROOF=NO", w)
        self.assertIn("'physical_write_authorized'\] is False", w.replace('proof["physical_write_authorized"]',"'physical_write_authorized']"))
        self.assertIn("RAW_IMAGE_EXISTS_ONLY_IN_EPHEMERAL_RUNNER=YES", w)
        self.assertIn("rm -f \"$RUNNER_TEMP/ordax-proof/ordax-disposable.raw\"", w)
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("gh release", w)
        self.assertNotIn("contents: write", w)


if __name__ == "__main__":
    unittest.main()
