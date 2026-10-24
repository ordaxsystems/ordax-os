#!/usr/bin/env python3
"""Prevent unrelated OS edits from silently republishing Creator dev releases."""
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
WORKFLOW=ROOT/".github/workflows/creator-dev-channel.yml"
CONTRACT=ROOT/"docs/contracts/native-release-assembly.json"

class CreatorDevReleaseGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=WORKFLOW.read_text(encoding="utf-8")
        cls.source=json.loads(CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_manual_only_until_external_source_cutover(self):
        triggers=cls.text.split("on:\n",1)[1].split("\npermissions:",1)[0]
        self.assertIn("workflow_dispatch:",triggers)
        self.assertNotIn("push:",triggers)
        self.assertNotIn("pull_request:",triggers)
        self.assertIn("github.event_name == 'workflow_dispatch'",cls.text)
        self.assertIn("github.ref == 'refs/heads/main'",cls.text)

    def test_legacy_endpoint_and_payload_guard_not_changed(self):
        self.assertIn("https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/ordax-creator-dev-windows-amd64.zip",cls.text)
        self.assertIn("prototype-ordax.creator-update-channel/1",cls.text)
        self.assertIn("raw_backend_linked",cls.text)
        self.assertIn("physical_write_authorized",cls.text)
        self.assertIn("CREATOR_DEV_CHANNEL_CAN_AUTHORIZE_PHYSICAL_WRITE=NO",cls.text)
        self.assertIn("gh release upload creator-dev",cls.text)
        self.assertEqual(self.source["publisher_authority"],"ordaxsystems/ordax-os")
        self.assertIs(self.source["physical_apply_authorized"],False)

if __name__=="__main__":
    unittest.main()
