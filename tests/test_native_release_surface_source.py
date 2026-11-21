"""Native Surface provenance must prove the same committed OS Git blobs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "tools/native-release-assembly/build.py"
spec = importlib.util.spec_from_file_location("native_surface_proof", MODULE)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeSameCommitProof(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.stage = self.root / "candidate"
        self.system = self.stage / "system"
        for args in (
            ("init", "-q"),
            ("config", "user.name", "CI proof"),
            ("config", "user.email", "ci@example.invalid"),
        ):
            subprocess.run(["git", "-C", str(self.root), *args],
                           check=True, capture_output=True)
        files = [
            ("system/surface/ui/surface.mjs", b"UI\n"),
            ("system/surface/workspace/view.tsx", b"WORKSPACE\n"),
        ]
        digest = hashlib.sha256()
        for relative, data in files:
            source = self.root / relative
            staged = self.stage / relative
            for path in (source, staged):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            digest.update(relative.encode("utf-8") + b"\0")
            digest.update(hashlib.sha256(data).digest())
        policy = {
            "$schema": "prototype-ordax.surface-source/2",
            "status": "canonical",
            "source_repository": "ordaxsystems/ordax-os",
            "source_ref": "same-commit",
            "source_policy": "tracked-git-blobs-only",
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
            "physical_disk_write_allowed": False,
        }
        lock = self.root / "docs/contracts/surface-source.json"
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps(policy), encoding="utf-8")
        for args in (("add", "docs", "system"), ("commit", "-qm", "source")):
            subprocess.run(["git", "-C", str(self.root), *args],
                           check=True, capture_output=True)
        self.sha = subprocess.check_output(
            ["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True
        ).strip()
        self.receipt = {
            "$schema": "prototype-ordax.surface-assembly/2",
            "os_commit": self.sha,
            "surface_source_repository": "ordaxsystems/ordax-os",
            "surface_source_commit": self.sha,
            "user_interface_owner": "ordaxsystems/ordax-os",
            "single_visual_source": True,
            "visual_paths": policy["visual_source_paths"],
            "visual_file_count": len(files),
            "visual_source_sha256": digest.hexdigest(),
        }
        self.save()

    def save(self):
        (self.system / "surface/source-provenance.json").write_text(
            json.dumps(self.receipt), encoding="utf-8"
        )

    def verify(self):
        with patch.object(native, "ROOT", self.root), patch.object(
            native, "git_head", return_value=self.sha
        ):
            return native.verify_same_commit_surface_system(self.system)

    def test_exact_committed_os_visual_passes(self):
        self.assertEqual(self.verify(), self.receipt)

    def test_staged_visual_tampering_fails(self):
        (self.system / "surface/ui/surface.mjs").write_bytes(b"TAMPER")
        with self.assertRaises(native.AssemblyError):
            self.verify()

    def test_self_signed_forged_receipt_cannot_replace_git_source(self):
        (self.system / "surface/ui/surface.mjs").write_bytes(b"TAMPER")
        digest = hashlib.sha256()
        for name in ("system/surface/ui/surface.mjs", "system/surface/workspace/view.tsx"):
            data = (self.stage / name).read_bytes()
            digest.update(name.encode("utf-8") + b"\0")
            digest.update(hashlib.sha256(data).digest())
        self.receipt["visual_source_sha256"] = digest.hexdigest()
        self.save()
        with self.assertRaises(native.AssemblyError):
            self.verify()

    def test_wrong_revision_or_owner_fails(self):
        self.receipt["surface_source_commit"] = "b" * 40
        self.save()
        with self.assertRaises(native.AssemblyError):
            self.verify()
        self.receipt["surface_source_commit"] = self.sha
        self.receipt["user_interface_owner"] = "untrusted/owner"
        self.save()
        with self.assertRaises(native.AssemblyError):
            self.verify()

    def test_missing_receipt_fails(self):
        (self.system / "surface/source-provenance.json").unlink()
        with self.assertRaises(native.AssemblyError):
            self.verify()


if __name__ == "__main__":
    unittest.main()
