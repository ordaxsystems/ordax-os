#!/usr/bin/env python3
"""Creator same-commit source boundary regression tests using disposable Git trees only."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("native_creator_source_boundary", ROOT / "tools/native-release-assembly/build.py")
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


class CreatorMonorepoSourceTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.creator = self.root / "creator"
        self.creator.mkdir()
        git(self.root, "init", "-q")
        (self.creator / "go.mod").write_text("module github.com/ordaxsystems/ordax-os/creator\n\ngo 1.27.0\n")
        entry = self.creator / "cmd/ordax-creator-native-targets/main.go"
        entry.parent.mkdir(parents=True)
        entry.write_text("package main\nfunc main() {}\n")
        git(self.root, "add", "creator")
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=creator-test",
                        "-c", "user.email=creator@example.invalid", "commit", "-qm", "fixture"], check=True)
        self.contract_patch = patch.object(native, "CREATOR_SOURCE_CONTRACT", CONTRACT)
        self.root_patch = patch.object(native, "ROOT", self.root)
        self.contract_patch.start()
        self.root_patch.start()
        self.addCleanup(self.contract_patch.stop)
        self.addCleanup(self.root_patch.stop)

    def test_exact_same_commit_module_is_accepted(self):
        pin = native.verify_monorepo_creator_source(self.creator)
        self.assertEqual(pin["commit"], git(self.root, "rev-parse", "HEAD"))
        self.assertEqual(pin["tree"], git(self.root, "rev-parse", "HEAD:creator"))
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-os")

    def test_different_directory_fails_closed(self):
        with self.assertRaisesRegex(native.AssemblyError, "OS creator/"):
            native.verify_monorepo_creator_source(self.root)

    def test_dirty_creator_go_module_fails_closed(self):
        (self.creator / "go.mod").write_text("module untrusted/creator\n")
        with self.assertRaisesRegex(native.AssemblyError, "differs"):
            native.verify_monorepo_creator_source(self.creator)

    def test_untracked_creator_source_fails_closed(self):
        (self.creator / "unexpected.go").write_text("package creator\n")
        with self.assertRaisesRegex(native.AssemblyError, "differs"):
            native.verify_monorepo_creator_source(self.creator)

    def test_missing_entrypoint_fails_closed(self):
        (self.creator / "cmd/ordax-creator-native-targets/main.go").unlink()
        with self.assertRaises(native.AssemblyError):
            native.verify_monorepo_creator_source(self.creator)

    def test_source_receipt_binds_same_git_commit_and_subtree(self):
        spec = next(h for h in native.HELPERS if h.get("monorepo_creator_source"))
        binary = self.root / "synthetic-helper.bin"
        binary.write_bytes(b"fake executable bytes; never executed")
        rec = native.tool_provenance(spec, binary)
        self.assertEqual(rec["source_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(rec["source_commit"], git(self.root, "rev-parse", "HEAD"))
        self.assertEqual(rec["source_tree"], git(self.root, "rev-parse", "HEAD:creator"))
        self.assertIs(rec["physical_apply_authorized"], False)
        self.assertIs(rec["component_publish_authorized"], False)


class CanonicalContractTests(unittest.TestCase):
    def test_one_monorepo_module_no_competing_pin(self):
        pin = json.loads(CONTRACT.read_text())["creator_source"]
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-os")
        self.assertEqual(pin["path"], "creator")
        self.assertEqual(pin["module"], "github.com/ordaxsystems/ordax-os/creator")
        self.assertNotIn("commit", pin)
        self.assertNotIn("tree", pin)
        self.assertIs(pin["physical_apply_authorized"], False)

    def test_invalid_source_authority_rejected(self):
        source = json.loads(CONTRACT.read_text())
        with tempfile.TemporaryDirectory() as t:
            lock = Path(t) / "contract.json"
            for change in ({"repository":"attacker/creator"}, {"path":"other"},
                           {"physical_apply_authorized": True}, {"commit":"main"},
                           {"tree":"0"*40}):
                current = json.loads(json.dumps(source))
                current["creator_source"].update(change)
                lock.write_text(json.dumps(current))
                with patch.object(native, "CREATOR_SOURCE_CONTRACT", lock):
                    with self.assertRaises(native.AssemblyError):
                        native.creator_source_pin()


if __name__ == "__main__":
    unittest.main()
