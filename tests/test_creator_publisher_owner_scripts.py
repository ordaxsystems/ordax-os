#!/usr/bin/env python3
"""OS owns publisher scripts; Creator independent source does not own signing."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PUBLISHER=ROOT/"tools/release-signing/windows"
LEGACY=ROOT/"tools/creator/windows"
WORKFLOW_OFFICIAL=ROOT/".github/workflows/creator-official-candidate.yml"
WORKFLOW_SIGNING=ROOT/".github/workflows/creator-code-signing-boundary.yml"
NAMES=(
    "Build-OrdaXCreatorPublisherHandoff.ps1",
    "Verify-OrdaXCreatorSignature.ps1",
    "Finalize-OrdaXCreatorRelease.ps1",
)

class CreatorPublisherOwnerTests(unittest.TestCase):
    def test_one_publisher_location_no_duplicate_legacy_scripts(self):
        for name in NAMES:
            self.assertTrue((PUBLISHER/name).is_file(), name)
            self.assertFalse((LEGACY/name).exists(), name)

    def test_first_usb_readiness_uses_os_publisher_finalizer(self):
        from importlib.util import module_from_spec, spec_from_file_location
        path = ROOT / "tools/ops/first_mvp_operator_readiness.py"
        spec = spec_from_file_location("creator_first_usb_owner", path)
        self.assertIsNotNone(spec)
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.CREATOR_FINALIZER_PATH, PUBLISHER / "Finalize-OrdaXCreatorRelease.ps1")
        self.assertTrue(module.CREATOR_FINALIZER_PATH.is_file())

    def test_os_owned_workflows_use_publisher_scripts(self):
        joined=WORKFLOW_OFFICIAL.read_text(encoding="utf-8")+"\n"+WORKFLOW_SIGNING.read_text(encoding="utf-8")
        for name in NAMES:
            self.assertIn("tools/release-signing/windows/"+name,joined)
            self.assertNotIn("tools/creator/windows/"+name,joined)

    def test_publisher_handoff_consumes_independent_creator_and_keeps_policy(self):
        text=(PUBLISHER/NAMES[0]).read_text(encoding="utf-8")
        self.assertIn("Push-Location $creatorRoot",text)
        self.assertIn("docs/contracts/native-release-assembly.json",text)
        self.assertIn("creator_source_commit = $creatorCommit",text)
        self.assertIn("tools/release-signing/windows/Verify-OrdaXCreatorSignature.ps1",text)
        self.assertIn("tools/release-signing/windows/Finalize-OrdaXCreatorRelease.ps1",text)
        for key in ("publishable_to_end_users = $false","authenticode_signed = $false","private_key_embedded = $false"):
            self.assertIn(key,text)
        self.assertIn("tools/release-signing",text)

if __name__=="__main__":
    unittest.main()
