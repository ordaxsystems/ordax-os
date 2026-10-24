#!/usr/bin/env python3
"""Read-only single-source and fail-closed publisher handoff regression tests."""
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"tools/creator/windows/Build-OrdaXCreatorPublisherHandoff.ps1"
WORKFLOW=ROOT/".github/workflows/creator-official-candidate.yml"
CONTRACT=ROOT/"docs/contracts/native-release-assembly.json"

class CreatorOfficialExternalHandoff(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script=SCRIPT.read_text(encoding="utf-8")
        cls.workflow=WORKFLOW.read_text(encoding="utf-8")
        cls.pin=json.loads(CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_exact_pin_consumed_by_all_jobs(self):
        self.assertEqual(self.pin["repository"],"ordaxsystems/ordax-creator")
        self.assertEqual(self.pin["publisher_authority"],"ordaxsystems/ordax-os")
        self.assertIs(self.pin["physical_apply_authorized"],False)
        self.assertEqual(self.workflow.count("uses: ./.github/actions/resolve-creator-source"),3)
        self.assertEqual(self.workflow.count("-CreatorSourceDirectory $env:ORDAX_CREATOR_NATIVE_SOURCE"),2)
        self.assertIn("os.environ['ORDAX_CREATOR_NATIVE_SOURCE']",self.workflow)
        self.assertNotIn("tools/creator/physicalchannel/channel.go",self.workflow)

    def test_wrong_source_rejected_before_output(self):
        before=self.script.split("$OutputDirectory = Get-EmptyOutputDirectory")[0]
        for value in ("native-release-assembly.json","rev-parse HEAD","HEAD^{tree}",
                      "status --porcelain --untracked-files=all","Creator Go module",
                      "Creator source Git SHA differs","Creator source Git tree differs"):
            self.assertIn(value,before)
        self.assertIn("Push-Location $creatorRoot",self.script)
        self.assertNotIn("Push-Location (Join-Path $repoRoot 'tools/creator')",self.script)
        self.assertIn("CREATOR_WRONG_SOURCE_FAIL_CLOSED=PASS",self.workflow)

    def test_os_publisher_and_non_public_authority_preserved(self):
        for name in ("tools/release-signing","tools/creator/windows/Verify-OrdaXCreatorSignature.ps1",
                     "tools/creator/windows/Finalize-OrdaXCreatorRelease.ps1","authenticode_signed = $false",
                     "publishable_to_end_users = $false","creator_source_verified = $true",
                     "creator_source_commit = $creatorCommit","creator_source_tree = $creatorTree"):
            self.assertIn(name,self.script)
        self.assertIn("TrustClass 'ci-disposable'",self.workflow)
        self.assertIn("TrustClass 'canonical'",self.workflow)
        self.assertNotIn("gh release",self.workflow)

if __name__=="__main__":
    unittest.main()
