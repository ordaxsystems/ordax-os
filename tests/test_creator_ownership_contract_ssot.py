#!/usr/bin/env python3
"""Creator Go owners are immutable external source paths; OS owns only producers and authority."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PIN = ROOT / "docs/contracts/native-release-assembly.json"
PLAN = ROOT / "docs/contracts/creator-portable-media-plan.json"
FLOW = ROOT / "docs/contracts/creator-consumer-flow.json"

class IndependentCreatorOwnershipContractTests(unittest.TestCase):
    def test_go_code_owners_never_reference_embedded_legacy_tree(self):
        pin = json.loads(PIN.read_text(encoding="utf-8"))["creator_source"]
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        flow = json.loads(FLOW.read_text(encoding="utf-8"))
        prefix = "github.com/ordaxsystems/ordax-creator/"
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(pin["module"], prefix[:-1])
        self.assertIs(pin["physical_apply_authorized"], False)
        self.assertEqual(pin["publisher_authority"], "ordaxsystems/ordax-os")
        owners = [
            plan["core_owner"], plan["geometry_owner"],
            plan["application_planner"]["owner"], plan["physical_writer_v2"]["owner"],
            flow["physical_candidate_integrity"]["portable_source_preflight_owner"],
            flow["media_acquisition"]["owner"],
        ]
        self.assertTrue(all(owner.startswith(prefix) for owner in owners))
        self.assertFalse(any("tools/creator/core" in owner or "tools/creator/host" in owner for owner in owners))
        self.assertIn("tools/creator/proof/portable_prepared_media.py", plan["disposable_materializer"])
        self.assertEqual(plan["physical_write_authorized"], False)
        self.assertEqual(flow["physical_write_gate"]["internal_disk_write_allowed_in_mvp"], False)

    def test_os_documentation_does_not_claim_go_source_ownership(self):
        readme = (ROOT / "tools/creator/README.md").read_text(encoding="utf-8")
        self.assertIn("ordaxsystems/ordax-creator", readme)
        self.assertIn("docs/contracts/native-release-assembly.json#creator_source", readme)
        self.assertNotIn("is the single source root for OrdaX physical-media creation", readme)
        action = (ROOT / ".github/actions/resolve-creator-source/action.yml").read_text(encoding="utf-8")
        self.assertIn("rev-parse 'HEAD^{tree}'", action)
        self.assertIn("creator_source", action)

if __name__ == "__main__":
    unittest.main()
