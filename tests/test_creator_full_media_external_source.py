#!/usr/bin/env python3
"""Creator full-media verification is external; OS remains canonical media producer."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/full-bootstrap-media-proof.yml"
SOURCE = ROOT / "docs/contracts/native-release-assembly.json"


class CreatorFullMediaExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = WORKFLOW.read_text(encoding="utf-8")
        cls.pin = json.loads(SOURCE.read_text(encoding="utf-8"))["creator_source"]

    def test_one_immutable_creator_core_for_payload_and_tree(self):
        w = self.w
        self.assertEqual(self.pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.pin["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertFalse(self.pin["physical_apply_authorized"])
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn('git -C "$creator" rev-parse HEAD', w)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn('ORDAX_OS_CONTRACTS_DIR="$GITHUB_WORKSPACE/docs/contracts"', w)
        self.assertIn('"$creator" verify-payload', w)
        self.assertIn('"$creator" stage-tree', w)
        self.assertIn("PAYLOAD_VERIFIED=YES", w)
        self.assertIn("DISPOSABLE_TREE_STAGED=YES", w)
        self.assertNotIn("pushd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)

    def test_os_producers_and_unpublished_media_remain_unchanged(self):
        w = self.w
        self.assertIn("python tools/creator/assemble.py build", w)
        self.assertIn("python tools/creator/assemble.py verify", w)
        self.assertIn("python tools/creator/proof/disposable_media.py", w)
        self.assertIn("bootstrap/kernel/build.py build", w)
        self.assertIn("bootstrap/release-acquisition", w)
        self.assertIn("PHYSICAL_WRITE_STATUS=blocked", w)
        self.assertIn('rm -f "$RUNNER_TEMP/full-media-disk-proof/ordax-disposable.raw"', w)
        self.assertIn("Destroy unpublished media bytes", w)
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("contents: write", w)
        self.assertNotIn("gh release", w)


if __name__ == "__main__":
    unittest.main()
