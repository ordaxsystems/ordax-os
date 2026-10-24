#!/usr/bin/env python3
"""Component candidate uses independent Creator; OS keeps signed-release authority."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-component-candidate.yml"
SOURCE = ROOT / "docs/contracts/native-release-assembly.json"
CHANNEL = ROOT / "docs/contracts/creator-component-channel.json"

class CreatorComponentExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.source = json.loads(SOURCE.read_text(encoding="utf-8"))["creator_source"]
        cls.channel = json.loads(CHANNEL.read_text(encoding="utf-8"))

    def test_exact_single_pinned_source_with_separate_publisher(self):
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(self.source["physical_apply_authorized"], False)
        self.assertEqual(self.channel["source_repository"], "ordaxsystems/ordax-os")
        self.assertIs(self.channel["publish_allowed"], False)
        self.assertEqual(self.workflow.count("uses: ./.github/actions/resolve-creator-source"), 2)
        self.assertIn("docs/contracts/native-release-assembly.json", self.workflow)
        self.assertIn("rev-parse 'HEAD^{tree}'", self.workflow)
        self.assertIn("Push-Location $env:ORDAX_CREATOR_NATIVE_SOURCE", self.workflow)
        self.assertNotIn("Push-Location tools/creator", self.workflow)
        self.assertNotIn("working-directory: tools/creator", self.workflow)
        # Retired path may appear in CI triggers, never in source-execution steps.
        self.assertEqual(self.workflow.count("'tools/creator/componentchannel/**'"), 2)
        self.assertNotIn("python tools/creator/componentchannel/", self.workflow)
        self.assertNotIn("Push-Location tools/creator/componentchannel", self.workflow)

    def test_os_does_not_embed_a_second_component_packager(self):
        # CI invokes the canonical Creator packager from the pinned external checkout.
        # The OS owns signed-release policy and must not keep a competing Python copy.
        self.assertFalse((ROOT / 'tools/creator/componentchannel').exists())
        self.assertIn("$ORDAX_CREATOR_NATIVE_SOURCE/componentchannel/test_package_candidate.py", self.workflow)
        self.assertIn("$env:ORDAX_CREATOR_NATIVE_SOURCE 'componentchannel/package_candidate.py'", self.workflow)

    def test_external_packager_keeps_original_signed_channel_contract(self):
        text = self.workflow
        self.assertIn("componentchannel/test_package_candidate.py", text)
        self.assertIn("componentchannel/package_candidate.py", text)
        self.assertIn("go test -count=1 ./componentchannel", text)
        self.assertIn("go test -count=1 ./host/windows", text)
        self.assertIn("./cmd/ordax-creator-inspection", text)
        self.assertIn("tools/release-signing", text)
        self.assertIn("creator-component-manifest.json", text)
        self.assertIn("source_repository -cne 'ordaxsystems/ordax-os'", text)
        self.assertIn("prototype-ordax.creator-component-implementation-provenance/1", text)
        self.assertIn("publisher_commit", text)
        self.assertIn("creator_source_commit", text)
        self.assertIn("creator_source_tree", text)

    def test_no_signing_keys_release_upload_or_physical_gate_bypass(self):
        text = self.workflow
        self.assertIn("permissions:\n  contents: read", text)
        self.assertNotIn("gh release", text)
        self.assertIn("CREATOR_COMPONENT_ENVELOPE_PRESENT=NO", text)
        self.assertIn("PRIVATE_KEY_REQUIRED_IN_CI=NO", text)
        self.assertIn("raw_backend_linked", text)
        self.assertIn("physical_write_authorized", text)
        self.assertIn("signed_release_created = $false", text)
        self.assertIs(self.channel["publisher_private_key_in_ci_artifact"], False)

if __name__ == "__main__":
    unittest.main()
