"""Release assembly: exactly one source of visuals with reproducible OS ownership."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1] / "tools/surface-source/assemble.py"
spec = importlib.util.spec_from_file_location("test_ordax_surface_assembly", HERE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(root: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=True, text=True)
    return p.stdout.strip()


class AssembledSurfaceReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.os = self.root / "os"
        self.ui = self.root / "surface"
        self.os.mkdir()
        self.ui.mkdir()
        for root in (self.os, self.ui):
            git(root, "init", "-q")
            git(root, "config", "user.name", "CI proof")
            git(root, "config", "user.email", "ci@localhost.invalid")
        self.create(self.os, "system/entrypoint", b"#!/bin/sh\nexit 0\n")
        (self.os / "system/entrypoint").chmod(0o755)
        self.create(self.os, "system/supervisor", b"OS_HOST_OWNER\n")
        self.create(self.os, "system/surface/runtime/native_host_server.py", b"OS_RUNTIME_OWNER\n")
        self.create(self.os, "system/surface/ui/view.mjs", b"OLD_OS_UI_MUST_NOT_SHIP\n")
        self.create(self.os, "system/surface/workspace/root.tsx", b"OLD_OS_WORKSPACE_MUST_NOT_SHIP\n")
        self.create(self.ui, "system/surface/ui/view.mjs", b"NEW_SURFACE_UI\n")
        self.create(self.ui, "system/surface/workspace/root.tsx", b"NEW_SURFACE_WORKSPACE\n")
        for root in (self.os, self.ui):
            git(root, "add", ".")
            git(root, "commit", "-qm", "test fixture")
        self.lock = self.root / "surface-lock.json"
        self.write_lock()

    @staticmethod
    def create(root: Path, name: str, data: bytes):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def write_lock(self):
        self.lock.write_text(json.dumps({
            "$schema": "prototype-ordax.surface-source/1",
            "status": "integration-candidate",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": git(self.ui, "rev-parse", "HEAD"),
            "visual_source_paths": list(module.source.VISUAL_PATHS),
        }), encoding="utf-8")

    def test_release_contains_one_canonical_visual_and_existing_native_owner(self):
        out = self.root / "assembled"
        receipt = module.assemble(self.os, self.ui, out, self.lock)
        self.assertEqual(receipt["visual_file_count"], 2)
        self.assertEqual(receipt["os_commit"], git(self.os, "rev-parse", "HEAD"))
        self.assertEqual(receipt["surface_source_commit"], git(self.ui, "rev-parse", "HEAD"))
        self.assertFalse(receipt["old_os_visual_source_packaged"])
        self.assertEqual((out / "system/surface/ui/view.mjs").read_bytes(), b"NEW_SURFACE_UI\n")
        self.assertEqual((out / "system/surface/workspace/root.tsx").read_bytes(), b"NEW_SURFACE_WORKSPACE\n")
        self.assertEqual((out / "system/surface/runtime/native_host_server.py").read_bytes(), b"OS_RUNTIME_OWNER\n")
        self.assertEqual((out / "system/supervisor").read_bytes(), b"OS_HOST_OWNER\n")
        self.assertEqual((out / module.PROVENANCE).read_text(), json.dumps(receipt, sort_keys=True, indent=2) + "\n")
        self.assertEqual((out / "system/entrypoint").stat().st_mode & 0o777, 0o755)
        self.assertNotIn(b"OLD_OS_UI", (out / "system/surface/ui/view.mjs").read_bytes())

    def test_same_release_from_os_with_old_visuals_removed(self):
        for part in ("ui", "workspace"):
            for path in (self.os / "system/surface" / part).iterdir():
                path.unlink()
            (self.os / "system/surface" / part).rmdir()
        out = self.root / "clean-assembled"
        receipt = module.assemble(self.os, self.ui, out, self.lock)
        self.assertEqual(receipt["visual_file_count"], 2)
        self.assertTrue((out / "system/surface/ui/view.mjs").is_file())

    def test_does_not_mutate_os_checkout_or_allow_second_write(self):
        out = self.root / "assembled"
        before = git(self.os, "status", "--porcelain")
        module.assemble(self.os, self.ui, out, self.lock)
        with self.assertRaisesRegex(module.source.SurfaceSourceError, "overwrite forbidden"):
            module.assemble(self.os, self.ui, out, self.lock)
        self.assertEqual(git(self.os, "status", "--porcelain"), before)
        self.assertIn(b"OLD_OS_UI", (self.os / "system/surface/ui/view.mjs").read_bytes())

    def test_rejects_staging_inside_source_tree(self):
        with self.assertRaisesRegex(module.source.SurfaceSourceError, "cannot modify"):
            module.assemble(self.os, self.ui, self.os / "danger", self.lock)

    def test_wrong_surface_sha_fails_before_staging(self):
        j = json.loads(self.lock.read_text())
        j["source_commit"] = "0" * 40
        self.lock.write_text(json.dumps(j))
        out = self.root / "wrong"
        with self.assertRaisesRegex(module.source.SurfaceSourceError, "not pinned"):
            module.assemble(self.os, self.ui, out, self.lock)
        self.assertFalse(out.exists())

    def test_rejects_link_in_native_source_tree(self):
        (self.os / "system/surface/runtime/extra.py").symlink_to("native_host_server.py")
        with self.assertRaisesRegex(module.source.SurfaceSourceError, "non-regular"):
            module.assemble(self.os, self.ui, self.root / "linked", self.lock)


if __name__ == "__main__":
    unittest.main()
