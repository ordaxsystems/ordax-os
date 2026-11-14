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

    def test_creator_consumers_watch_only_live_os_producer_paths(self):
        # External Creator Go is not vendored inside OS. Its only supported
        # integration boundary is the immutable source pin and resolver.
        retired_paths = (
            "tools/creator/core/",
            "tools/creator/cmd/",
            "tools/creator/host/",
            "tools/creator/physicalchannel/",
            "tools/creator/go.mod",
            "tools/creator/go.sum",
        )
        consumers = {
            "full-bootstrap-media-proof.yml": "tools/creator/assemble.py",
            "native-disposable-storage-proof.yml": "tools/creator/proof/native_disposable.py",
            "native-esp-candidate.yml": "tools/creator/proof/native_esp.py",
            "physical-write-promotion.yml": "tools/creator/physical_promotion.py",
            "portable-usb-v2-proof.yml": "tools/creator/proof/portable_usb_v2.py",
        }
        for filename, live_source in consumers.items():
            with self.subTest(workflow=filename):
                text = (ROOT / ".github/workflows" / filename).read_text(encoding="utf-8")
                events = text.split("\njobs:\n", 1)[0]
                for old in retired_paths:
                    self.assertNotIn(old, events)
                self.assertIn("docs/contracts/native-release-assembly.json", events)
                self.assertIn(".github/actions/resolve-creator-source/**", events)
                self.assertIn(live_source, events)
                self.assertIn("workflow_dispatch:", events)
                self.assertIn("uses: ./.github/actions/resolve-creator-source", text)

    def test_owner_usb_retains_go_resurrection_sentinels_only(self):
        source = (
            ROOT / ".github/workflows/creator-owner-dev-git.yml"
        ).read_text(encoding="utf-8")
        events = source.split("\njobs:\n", 1)[0]
        self.assertIn("docs/contracts/native-release-assembly.json", events)
        self.assertIn("tests/test_creator_no_embedded_go.py", events)
        for expected in (
            "tools/creator/**/*.go",
            "tools/creator/go.mod",
            "tools/creator/go.sum",
        ):
            self.assertIn(expected, events)
        self.assertNotIn("tools/creator/core/README.md", events)
        self.assertIn("resurrection sentinels", events)

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
