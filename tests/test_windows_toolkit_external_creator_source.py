#!/usr/bin/env python3
"""Contract regressions: toolkit consumes Creator source from OS pinned SSOT.

String-level workflow proofs supplement real Ubuntu + Windows GitHub Actions jobs;
no git checkout or disk/media operations are executed by these tests.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/windows-prototype-toolkit.yml"
ACTION = ROOT / ".github/actions/resolve-creator-source/action.yml"
CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


class WindowsToolkitExternalCreatorSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.action = ACTION.read_text(encoding="utf-8")
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_one_external_source_lock_shared_with_native_os_release(self):
        pin = self.contract["creator_source"]
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(pin["module"], "github.com/ordaxsystems/ordax-creator")
        self.assertFalse(pin["physical_apply_authorized"])
        self.assertIn("docs/contracts/native-release-assembly.json", self.action)
        self.assertEqual(
            self.workflow.count("uses: ./.github/actions/resolve-creator-source"), 2
        )
        self.assertNotIn("tools/creator/", self.workflow)

    def test_creator_and_os_publisher_have_separate_source_provenance(self):
        for key in (
            "creator_source_commit",
            "creator_source_tree",
            "creator_source_repository",
            "source_commit",
            "source_repository",
        ):
            self.assertIn(f"'{key}'", self.workflow)
        self.assertIn("os.environ['ORDAX_CREATOR_SOURCE_COMMIT']", self.workflow)
        self.assertIn("os.environ['GITHUB_SHA']", self.workflow)
        self.assertIn("'creator_build_from_external_verified_source': True", self.workflow)
        self.assertIn("physical_write_authorized", self.workflow)

    def test_os_signer_and_trust_ceremony_remain_in_os(self):
        self.assertIn("(cd tools/release-signing && go test -count=1 ./...)", self.workflow)
        self.assertIn("cd tools/release-signing", self.workflow)
        self.assertIn("tools/release-signing/windows/Initialize-OrdaXReleaseTrust.ps1", self.workflow)
        self.assertIn("tools/release-signing/windows/Complete-OrdaXReleaseTrust.ps1", self.workflow)
        self.assertIn("'private_key_included': False", self.workflow)
        self.assertNotIn("gh release", self.workflow)

    def test_ubuntu_and_windows_both_resolve_external_source(self):
        self.assertIn("ubuntu-24.04", self.workflow)
        self.assertIn("windows-latest", self.workflow)
        self.assertIn("ordax-creator-toolkit-source", self.workflow)
        self.assertIn("ordax-creator-native-win-source", self.workflow)
        self.assertIn("go test -count=1 -tags ordax_raw_backend ./host/windows", self.workflow)


if __name__ == "__main__":
    unittest.main()
