#!/usr/bin/env python3
"""Creator code signing CI source boundary; no production keys or hardware."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-code-signing-boundary.yml"
RESOLVER = ROOT / ".github/actions/resolve-creator-source/action.yml"
CREATOR_SOURCE = ROOT / "docs/contracts/native-release-assembly.json"
CODE_SIGNING = ROOT / "docs/contracts/creator-code-signing.json"


class CreatorCodeSigningExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.resolver = RESOLVER.read_text(encoding="utf-8")
        cls.pin = json.loads(CREATOR_SOURCE.read_text(encoding="utf-8"))["creator_source"]
        cls.signing = json.loads(CODE_SIGNING.read_text(encoding="utf-8"))

    def test_one_verified_creator_implementation_source(self):
        self.assertEqual(self.pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.pin["module"], "github.com/ordaxsystems/ordax-creator")
        self.assertFalse(self.pin["physical_apply_authorized"])
        self.assertIn("docs/contracts/native-release-assembly.json", self.resolver)
        self.assertIn("rev-parse 'HEAD^{tree}'", self.resolver)
        self.assertIn("uses: ./.github/actions/resolve-creator-source", self.workflow)
        self.assertIn("Push-Location $env:ORDAX_CREATOR_NATIVE_SOURCE", self.workflow)
        self.assertNotIn("Push-Location tools/creator", self.workflow)
        self.assertNotIn("tools/creator/cmd/", self.workflow)
        self.assertIn("go test -count=1 ./appchannel ./componentchannel ./physicalchannel", self.workflow)

    def test_os_publisher_keeps_exclusive_signature_boundary(self):
        self.assertIn("Push-Location tools/release-signing", self.workflow)
        self.assertIn("tools/creator/windows/Verify-OrdaXCreatorSignature.ps1", self.workflow)
        self.assertIn("tools/creator/windows/Finalize-OrdaXCreatorRelease.ps1", self.workflow)
        self.assertEqual(self.signing["status"], "unconfigured")
        self.assertFalse(self.signing["release_policy"]["publish_allowed"])
        self.assertFalse(self.signing["release_policy"]["unsigned_candidate_publishable"])
        self.assertIn("PRODUCTION", self.workflow.upper())
        self.assertNotIn("gh release", self.workflow)

    def test_negative_authenticode_and_unlisted_artifact_guards(self):
        for indicator in (
            "UNCONFIGURED_POLICY_FAIL_CLOSED=PASS",
            "UNSIGNED_LAUNCHER_FAIL_CLOSED=PASS",
            "UNSIGNED_APP_FAIL_CLOSED=PASS",
            "UNLISTED_EXECUTABLE_FAIL_CLOSED=PASS",
            "FINALIZER_PRE_AUTHENTICODE_FAIL_CLOSED=PASS",
            "FINALIZER_PREMATURE_MANIFEST=NO",
            "FINALIZER_PREMATURE_ENVELOPE=NO",
        ):
            self.assertIn(indicator, self.workflow)
        for name in ("OrdaX-Creator.exe", "OrdaX-Creator-App.exe"):
            self.assertIn(name, self.signing["artifacts"])
        self.assertIn("checkout-root: ${{ runner.temp }}/ordax-creator-authenticode-source", self.workflow)


if __name__ == "__main__":
    unittest.main()
