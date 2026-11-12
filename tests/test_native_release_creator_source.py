#!/usr/bin/env python3
"""Fail-closed source boundary tests for the externally owned Native helper.

All Git repositories and files are disposable synthetic test fixtures.
No block device, network source, or physical media is opened.
"""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "native_creator_source_boundary", ROOT / "tools/native-release-assembly/build.py"
)
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)

PIN = json.loads(
    (ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8")
)["creator_source"]


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


class ExternalCreatorSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.checkout = Path(temporary.name) / "creator"
        self.checkout.mkdir()
        git(self.checkout, "init", "--quiet")
        (self.checkout / "go.mod").write_text(
            "module github.com/ordaxsystems/ordax-creator\n\ngo 1.27.0\n",
            encoding="utf-8",
        )
        entrypoint = self.checkout / "cmd/ordax-creator-native-targets/main.go"
        entrypoint.parent.mkdir(parents=True)
        entrypoint.write_text("package main\n\nfunc main() {}\n", encoding="utf-8")
        git(self.checkout, "add", ".")
        git(
            self.checkout, "-c", "user.name=CreatorBoundaryTest",
            "-c", "user.email=test@example.invalid", "commit", "-qm", "synthetic source"
        )
        self.synthetic_pin = {
            **PIN,
            "commit": git(self.checkout, "rev-parse", "HEAD"),
            "tree": git(self.checkout, "rev-parse", "HEAD^{tree}"),
        }

    def verify(self):
        with patch.object(native, "creator_source_pin", return_value=self.synthetic_pin):
            return native.verify_external_creator_source(self.checkout)

    def test_exact_standalone_commit_and_tree_is_accepted(self):
        self.assertEqual(self.verify(), self.synthetic_pin)

    def test_dirty_source_tree_fails_closed(self):
        (self.checkout / "go.mod").write_text("module wrong/authority\n")
        with self.assertRaisesRegex(native.AssemblyError, "dirty"):
            self.verify()

    def test_untracked_source_fails_closed(self):
        (self.checkout / "unauthorized.go").write_text("package unknown\n")
        with self.assertRaisesRegex(native.AssemblyError, "untrusted"):
            self.verify()

    def test_wrong_commit_is_rejected(self):
        self.synthetic_pin["commit"] = "a" * 40
        with self.assertRaisesRegex(native.AssemblyError, "Git commit"):
            self.verify()

    def test_wrong_tree_is_rejected(self):
        self.synthetic_pin["tree"] = "b" * 40
        with self.assertRaisesRegex(native.AssemblyError, "Git tree"):
            self.verify()

    def test_invalid_module_is_rejected_even_when_committed(self):
        (self.checkout / "go.mod").write_text("module wrong/authority\n")
        git(self.checkout, "add", ".")
        git(
            self.checkout, "-c", "user.name=CreatorBoundaryTest",
            "-c", "user.email=test@example.invalid", "commit", "-qm", "wrong module"
        )
        self.synthetic_pin["commit"] = git(self.checkout, "rev-parse", "HEAD")
        self.synthetic_pin["tree"] = git(self.checkout, "rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(native.AssemblyError, "Go module"):
            self.verify()

    def test_unsafe_symlink_checkout_is_rejected(self):
        alias = self.checkout.parent / "creator-alias"
        alias.symlink_to(self.checkout, target_is_directory=True)
        with patch.object(native, "creator_source_pin", return_value=self.synthetic_pin):
            with self.assertRaisesRegex(native.AssemblyError, "real directory"):
                native.verify_external_creator_source(alias)

    def test_missing_native_entrypoint_is_rejected(self):
        entrypoint = self.checkout / "cmd/ordax-creator-native-targets/main.go"
        entrypoint.unlink()
        git(self.checkout, "add", "-u")
        git(
            self.checkout, "-c", "user.name=CreatorBoundaryTest",
            "-c", "user.email=test@example.invalid", "commit", "-qm", "remove entrypoint"
        )
        self.synthetic_pin["commit"] = git(self.checkout, "rev-parse", "HEAD")
        self.synthetic_pin["tree"] = git(self.checkout, "rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(native.AssemblyError, "missing or linked"):
            self.verify()

    def test_source_provenance_is_exact_and_tampering_is_rejected(self):
        binary = self.checkout.parent / "synthetic-helper.bin"
        binary.write_bytes(b"fake binary bytes, not runnable")
        spec = next(h for h in native.HELPERS if h.get("external_creator_source"))
        with patch.object(native, "creator_source_pin", return_value=self.synthetic_pin):
            receipt = native.tool_provenance(spec, binary)
            self.assertEqual(receipt["source_repository"], PIN["repository"])
            self.assertEqual(receipt["source_commit"], self.synthetic_pin["commit"])
            self.assertEqual(receipt["source_tree"], self.synthetic_pin["tree"])
            self.assertIs(receipt["physical_apply_authorized"], False)
            self.assertIs(receipt["component_publish_authorized"], False)


class CanonicalCreatorSourceLockTests(unittest.TestCase):
    def test_source_lock_is_one_canonical_contract_without_legacy_core(self):
        contract = json.loads(
            (ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8")
        )
        self.assertEqual(contract["creator_source"]["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(contract["creator_source"]["module"], "github.com/ordaxsystems/ordax-creator")
        self.assertFalse(contract["creator_source"]["physical_apply_authorized"])
        self.assertRegex(contract["creator_source"]["commit"], r"^[a-f0-9]{40}$")
        self.assertRegex(contract["creator_source"]["tree"], r"^[a-f0-9]{40}$")
        self.assertFalse(any(p.startswith("tools/creator/") for p in contract["source_inputs"]))

    def test_source_lock_rejects_unsigned_or_wrong_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / "native-release-assembly.json"
            for changed in ({"repository": "untrusted/creator"}, {"physical_apply_authorized": True},
                            {"commit": "main"}, {"tree": "0" * 39}):
                data = json.loads(
                    (ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8")
                )
                data["creator_source"].update(changed)
                lock.write_text(json.dumps(data), encoding="utf-8")
                with patch.object(native, "CREATOR_SOURCE_CONTRACT", lock):
                    with self.assertRaises(native.AssemblyError):
                        native.creator_source_pin()

    def test_assembly_without_external_source_fails_before_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "missing-source-out"
            with self.assertRaisesRegex(native.AssemblyError, "requires an explicit pinned"):
                native.assemble(destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
