#!/usr/bin/env python3
"""Creator dev: exact source, read-only CI, manual OS publishing, legacy V1."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-dev-channel.yml"
PIN = ROOT / "docs/contracts/native-release-assembly.json"

class CreatorDevReleaseGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.pin = json.loads(PIN.read_text(encoding="utf-8"))["creator_source"]

    def test_candidate_ci_cannot_publish(self):
        text = self.workflow
        events = text.split("on:\n", 1)[1].split("\npermissions:", 1)[0]
        for label in ("push:", "pull_request:", "workflow_dispatch:"):
            self.assertIn(label, events)
        self.assertNotIn("tools/creator/**", events)
        self.assertIn("permissions:\n  contents: read", text)
        candidate = text.split("  build-creator-dev-candidate:\n",1)[1].split("\n  publish-creator-dev:",1)[0]
        self.assertNotIn("gh release", candidate)
        self.assertNotIn("contents: write", candidate)
        self.assertIn("actions/upload-artifact@", candidate)

    def test_publisher_requires_explicit_os_main_and_separate_credentials(self):
        publisher = self.workflow.split("\n  publish-creator-dev:\n", 1)[1]
        self.assertIn("needs: build-creator-dev-candidate", publisher)
        self.assertIn("github.event_name == 'workflow_dispatch'", publisher)
        self.assertIn("github.ref == 'refs/heads/main'", publisher)
        self.assertIn("github.repository == 'ordaxsystems/ordax-os'", publisher)
        self.assertIn("contents: write", publisher)
        self.assertIn("cancel-in-progress: false", publisher)
        self.assertIn("actions/download-artifact@", publisher)
        self.assertIn("docs/contracts/native-release-assembly.json", publisher)

    def test_one_source_pin_and_legacy_consumer_interface(self):
        self.assertEqual(self.pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.pin["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(self.pin["physical_apply_authorized"], False)
        text = self.workflow
        self.assertIn("uses: ./.github/actions/resolve-creator-source", text)
        self.assertIn("Push-Location $env:ORDAX_CREATOR_NATIVE_SOURCE", text)
        self.assertNotIn("Push-Location tools/creator", text)
        self.assertIn("$sha = $env:ORDAX_CREATOR_SOURCE_COMMIT", text)
        self.assertIn("prototype-ordax.creator-update-channel/1", text)
        self.assertIn("https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/ordax-creator-dev-windows-amd64.zip", text)
        for path in ("1-Inspect-OrdaXUSB.cmd", "2-Legacy-Protocol-Compatibility.cmd", "ordax-creator-physical-test.exe"):
            self.assertIn(path, text)
        for flag in ("raw_backend_linked", "physical_write_authorized", "CREATOR_DEV_CHANNEL_CAN_AUTHORIZE_PHYSICAL_WRITE=NO", "CREATOR_DEV_SOURCE_LOCK=VERIFIED"):
            self.assertIn(flag, text)
        self.assertIn("creator_source_tree", text)
        self.assertIn("publisher_commit", text)

if __name__ == "__main__":
    unittest.main()
