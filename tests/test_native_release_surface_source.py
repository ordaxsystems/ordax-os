"""Native build may only extend verified OS/Surface release source bytes."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools/native-release-assembly/build.py"
SPEC = importlib.util.spec_from_file_location("native_release_surface_source_proof", MODULE_PATH)
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)

OS_SHA = "a" * 40
SURFACE_SHA = "b" * 40


class NativeExternalSourceProofTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.system = self.root / "candidate/system"
        for area, filename, data in [
            ("ui", "surface.mjs", b"export const surface = true;\n"),
            ("workspace", "shell.tsx", b"export const shell = true;\n"),
        ]:
            path = self.system / "surface" / area / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        lock = self.root / "docs/contracts/surface-source.json"
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": SURFACE_SHA,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
        }))
        digest = hashlib.sha256()
        files = sorted([
            self.system / "surface/ui/surface.mjs",
            self.system / "surface/workspace/shell.tsx",
        ], key=lambda f: f.relative_to(self.system.parent).as_posix())
        for file in files:
            digest.update(file.relative_to(self.system.parent).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(file.read_bytes()).digest())
        self.receipt = {
            "$schema": "prototype-ordax.surface-assembly/1",
            "os_commit": OS_SHA,
            "surface_source_repository": "ordaxsystems/ordax-surface",
            "surface_source_commit": SURFACE_SHA,
            "visual_paths": ["system/surface/ui", "system/surface/workspace"],
            "visual_file_count": 2,
            "visual_source_sha256": digest.hexdigest(),
            "old_os_visual_source_packaged": False,
        }
        self.write_receipt()

    def write_receipt(self):
        (self.system / "surface/source-provenance.json").write_text(
            json.dumps(self.receipt), encoding="utf-8"
        )

    def verify(self):
        with patch.object(native, "ROOT", self.root), patch.object(native, "git_head", return_value=OS_SHA):
            return native.verify_external_surface_system(self.system)

    def test_verifies_both_exact_commits_and_visual_fingerprint(self):
        self.assertEqual(self.verify(), self.receipt)

    def test_byte_tampering_is_rejected(self):
        (self.system / "surface/ui/surface.mjs").write_bytes(b"altered")
        with self.assertRaisesRegex(native.AssemblyError, "fingerprint"):
            self.verify()

    def test_mismatched_surface_revision_is_rejected(self):
        self.receipt["surface_source_commit"] = "c" * 40
        self.write_receipt()
        with self.assertRaisesRegex(native.AssemblyError, "not bound"):
            self.verify()

    def test_missing_verification_receipt_is_rejected(self):
        (self.system / "surface/source-provenance.json").unlink()
        with self.assertRaisesRegex(native.AssemblyError, "requires verified"):
            self.verify()

    def test_unsafe_old_source_flag_is_rejected(self):
        self.receipt["old_os_visual_source_packaged"] = True
        self.write_receipt()
        with self.assertRaisesRegex(native.AssemblyError, "not bound"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
