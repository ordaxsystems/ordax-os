#!/usr/bin/env python3
"""Creator UX workflows verify immutable standalone GUI; OS owns release gates."""
import json
import os
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
WORKFLOW=ROOT/".github/workflows/creator-ux-baseline.yml"
PAINT=ROOT/"tests/test_creator_single_paint.py"
PIN=ROOT/"docs/contracts/native-release-assembly.json"

class CreatorUxStandaloneSource(unittest.TestCase):
    def test_go_source_from_single_canonical_immutable_pin(self):
        workflow=WORKFLOW.read_text(encoding="utf-8")
        source=json.loads(PIN.read_text(encoding="utf-8"))["creator_source"]
        self.assertEqual(source["repository"],"ordaxsystems/ordax-creator")
        self.assertEqual(source["publisher_authority"],"ordaxsystems/ordax-os")
        self.assertIs(source["physical_apply_authorized"],False)
        self.assertEqual(workflow.count("uses: ./.github/actions/resolve-creator-source"),1)
        self.assertIn("docs/contracts/native-release-assembly.json",workflow)
        self.assertIn("pushd \"$ORDAX_CREATOR_NATIVE_SOURCE\"",workflow)
        self.assertIn("creator_root / 'cmd/ordax-creator-app'",workflow)
        self.assertNotIn("pushd tools/creator",workflow)
        self.assertNotIn("root / 'tools/creator/cmd/ordax-creator-app'",workflow)

    def test_single_paint_one_test_suite_not_a_second_go_copy(self):
        workflow=WORKFLOW.read_text(encoding="utf-8")
        paint=PAINT.read_text(encoding="utf-8")
        self.assertIn("tests.test_creator_single_paint",workflow)
        self.assertIn('os.environ["ORDAX_CREATOR_NATIVE_SOURCE"]',paint)
        self.assertNotIn("creator_source_commit = 'main'",workflow)
        self.assertIn("-tags 'ordax_raw_backend'",workflow)
        self.assertIn("-tags 'ordax_owner_prototype'",workflow)
        self.assertIn("creator-owner-dev-git.yml",workflow)
        self.assertIn("creatorSupportedLocales()",workflow)
        self.assertIn("OWNER_STANDALONE_EXE_PUBLISHED=NO",workflow)
        self.assertIn("permissions:\n  contents: read",workflow)
        self.assertNotIn("gh release",workflow)

if __name__=="__main__":
    unittest.main()
