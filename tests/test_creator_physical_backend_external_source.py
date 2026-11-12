#!/usr/bin/env python3
"""The Windows raw backend is tested from the locked Creator source, never OS legacy Go."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/physical-usb-test-toolkit.yml"
CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


class CreatorPhysicalBackendExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.source = json.loads(CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_raw_go_package_is_single_pinned_implementation(self):
        w = self.workflow
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertFalse(self.source["physical_apply_authorized"])
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn("docs/contracts/native-release-assembly.json", w)
        self.assertIn("ORDAX_CREATOR_SOURCE_COMMIT", w)
        self.assertIn("ORDAX_CREATOR_SOURCE_TREE", w)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn("module github.com/ordaxsystems/ordax-creator", w)
        self.assertIn("ORDAX_OS_CONTRACTS_DIR", w)
        self.assertNotIn("Push-Location tools/creator", w)
        self.assertNotIn("'tools/creator/host/windows/portable_apply_windows.go'", w)
        self.assertIn("(Join-Path $source 'core/portable_application_executor.go')", w)

    def test_raw_backend_is_proven_blocked_without_physical_authorization(self):
        w = self.workflow
        self.assertIn("go test -count=1 -tags ordax_raw_backend ./host/windows", w)
        self.assertIn("go test -count=1 -tags ordax_raw_backend ./cmd/ordax-creator-physical-test", w)
        self.assertIn("build.ready -ne $false", w)
        self.assertIn("build.physical_write_authorized -ne $false", w)
        self.assertIn("PORTABLE_WRITER_READY=NO", w)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", w)
        self.assertIn("RAW_BACKEND_READY=NO", w)
        self.assertIn("END_USER_TOOLKIT_PUBLISHED=NO", w)
        self.assertIn("PUBLISHER_SIGNING_TOOL_IN_CONSUMER_ARTIFACT=NO", w)
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("contents: write", w)
        self.assertNotIn("gh release", w)
        self.assertIn("out/physical-backend-safety", w)


if __name__ == "__main__":
    unittest.main()
