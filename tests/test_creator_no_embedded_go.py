#!/usr/bin/env python3
"""Enforce the final C6 owner separation: zero duplicate Creator Go in ordax-os."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CREATOR = ROOT / "tools/creator"
PIN = ROOT / "docs/contracts/native-release-assembly.json"

class CreatorExternalGoOnlyTests(unittest.TestCase):
    def test_no_embedded_go_module_or_implementations_survive(self):
        remaining = sorted(
            str(file.relative_to(ROOT)) for file in CREATOR.rglob("*")
            if file.is_file() and (file.suffix == ".go" or file.name in ("go.mod","go.sum"))
        )
        self.assertEqual(remaining, [], "OS must not retain a second Creator Go implementation")
        self.assertFalse((CREATOR / "core").exists())
        self.assertFalse((CREATOR / "host").exists())
        self.assertFalse((CREATOR / "cmd").exists())
        self.assertFalse((CREATOR / "physicalchannel").exists())

    def test_exact_immutable_external_source_and_os_producers_coexist(self):
        contract = json.loads(PIN.read_text(encoding="utf-8"))
        source = contract["creator_source"]
        self.assertEqual(source["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(source["module"], "github.com/ordaxsystems/ordax-creator")
        self.assertEqual(source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(source["physical_apply_authorized"], False)
        self.assertEqual(len(source["commit"]), 40)
        self.assertEqual(len(source["tree"]), 40)
        resolver = (ROOT / ".github/actions/resolve-creator-source/action.yml").read_text(encoding="utf-8")
        self.assertIn("HEAD^{tree}", resolver)
        self.assertIn("status --porcelain --untracked-files=all", resolver)
        for path in (
            "tools/creator/assemble.py",
            "tools/creator/proof/disposable_media.py",
            "tools/creator/physical_promotion.py",
            "tools/creator/authorize_physical_write.py",
            "tools/creator/verify_owner_dev_bundle.py",
            "docs/contracts/physical-write-authorization.json",
        ):
            self.assertTrue((ROOT / path).is_file(), path)
        auth = json.loads((ROOT / "docs/contracts/physical-write-authorization.json").read_text(encoding="utf-8"))
        self.assertIs(auth["physical_write_allowed"], False)
        self.assertIs(auth["explicit_owner_authorization"], False)
        self.assertIsNone(auth["authorization_context_sha256"])

if __name__ == "__main__":
    unittest.main()
