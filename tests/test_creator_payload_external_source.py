#!/usr/bin/env python3
"""Read-only Creator payload candidate: OS assembles, immutable Creator verifies."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-payload-candidate.yml"
SOURCE = ROOT / "docs/contracts/native-release-assembly.json"
MANIFEST = ROOT / "docs/contracts/minimal-bootstrap.json"

class CreatorPayloadExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.source = json.loads(SOURCE.read_text(encoding="utf-8"))["creator_source"]
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_exact_standalone_source_single_pin_no_legacy_go(self):
        w = self.workflow
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(self.source["physical_apply_authorized"], False)
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn("docs/contracts/native-release-assembly.json", w)
        self.assertIn("git -C \"$creator\" rev-parse 'HEAD^{tree}'", w)
        self.assertIn("go test -count=1 ./cmd/ordax-creator ./core", w)
        self.assertIn('cd "$creator"', w)
        self.assertIn("./cmd/ordax-creator", w)
        self.assertNotIn("cd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)
        self.assertNotIn("'tools/creator/core/**'", w)
        self.assertNotIn("'tools/creator/cmd/**'", w)

    def test_os_manifest_assembler_and_source_identity_remain_authoritative(self):
        w = self.workflow
        self.assertEqual(self.manifest["$schema"], "prototype-ordax.minimal-bootstrap/4")
        self.assertIs(self.manifest["physical_write_allowed"], False)
        self.assertIn('ORDAX_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}', w)
        self.assertIn("python tools/creator/assemble.py build", w)
        self.assertIn("python tools/creator/assemble.py verify", w)
        self.assertIn('manifest="$GITHUB_WORKSPACE/docs/contracts/minimal-bootstrap.json"', w)
        self.assertIn('payload="$GITHUB_WORKSPACE/out/creator-payload"', w)
        self.assertIn('creator="$RUNNER_TEMP/creator-payload-cli/ordax-creator"', w)
        self.assertIn("CREATOR_PAYLOAD_OS_SOURCE_COMMIT", w)
        self.assertIn("CREATOR_IMPLEMENTATION_SOURCE_COMMIT", w)
        self.assertIn("PAYLOAD_VERIFIED=YES", w)
        self.assertIn("DISPOSABLE_TREE_STAGED=YES", w)

    def test_fail_closed_candidate_without_publisher_or_physical_authority(self):
        w = self.workflow
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("gh release", w)
        self.assertNotIn("contents: write", w)
        self.assertIn("PHYSICAL_WRITE_STATUS=blocked", w)
        self.assertIn("CREATOR_PAYLOAD_CLI_PHYSICAL_WRITE=NOT_AUTHORIZED", w)
        self.assertIn("uses: actions/upload-artifact@", w)
        self.assertIn("out/creator-payload/", w)

if __name__ == "__main__":
    unittest.main()
