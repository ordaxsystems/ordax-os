"""Fail-closed tests for the immutable cross-repository Surface source materializer."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "tools/surface-source/materialize.py"
SPEC = importlib.util.spec_from_file_location("surface_source_materialize", MODULE_PATH)
surface = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(surface)


class SurfaceSourceMaterializationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.run_git("init", "-q")
        self.run_git("config", "user.name", "test")
        self.run_git("config", "user.email", "test@localhost.invalid")
        for sub, filename in (("ui", "view.mjs"), ("workspace", "view.tsx")):
            target = self.source / "system" / "surface" / sub / filename
            target.parent.mkdir(parents=True)
            target.write_text(f"export const {sub} = true;\\n", encoding="utf-8")
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "test: pinned visual fixture")
        self.sha = self.run_git("rev-parse", "HEAD").strip()
        self.lock = {
            "$schema": "prototype-ordax.surface-source/1",
            "status": "integration-candidate",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": self.sha,
            "visual_source_paths": list(surface.VISUAL_PATHS),
        }

    def run_git(self, *args):
        proc = subprocess.run(
            ["git", "-C", str(self.source), *args],
            check=True, capture_output=True, text=True,
        )
        return proc.stdout

    def test_stage_uses_only_pinned_clean_visual_blobs(self):
        records, receipt = surface.verify_source(self.source, self.lock)
        self.assertEqual(receipt["source_commit"], self.sha)
        self.assertEqual(receipt["file_count"], 2)
        self.assertTrue(receipt["source_only"])
        self.assertFalse(receipt["live_os_mutated"])
        output = self.root / "out" / "surface"
        surface.stage_source(records, receipt, output)
        for name, payload in records:
            self.assertEqual((output / name).read_bytes(), payload)
        self.assertEqual(json.loads((output / "surface-source-receipt.json").read_text()), receipt)
        self.assertFalse((self.source / "surface-source-receipt.json").exists())

    def test_rejects_changed_source_revision(self):
        self.lock["source_commit"] = "0" * 40
        with self.assertRaisesRegex(surface.SurfaceSourceError, "not pinned"):
            surface.verify_source(self.source, self.lock)

    def test_rejects_dirty_source_bytes(self):
        (self.source / "system/surface/ui/view.mjs").write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(surface.SurfaceSourceError, "modified"):
            surface.verify_source(self.source, self.lock)

    def test_refuses_to_overwrite_staged_source(self):
        records, receipt = surface.verify_source(self.source, self.lock)
        output = self.root / "existing"
        output.mkdir()
        marker = output / "must-survive"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(surface.SurfaceSourceError, "already exists"):
            surface.stage_source(records, receipt, output)
        self.assertEqual(marker.read_text(), "keep")

    def test_rejects_symlink_in_tracked_visual_tree(self):
        link = self.source / "system/surface/ui/sneaky.mjs"
        link.symlink_to("view.mjs")
        self.run_git("add", "system/surface/ui/sneaky.mjs")
        self.run_git("commit", "-qm", "test: symlink")
        self.lock["source_commit"] = self.run_git("rev-parse", "HEAD").strip()
        with self.assertRaisesRegex(surface.SurfaceSourceError, "unsafe source mode"):
            surface.verify_source(self.source, self.lock)

    def test_validates_contract_boundary(self):
        lock_file = self.root / "surface-source.json"
        lock_file.write_text(json.dumps(self.lock), encoding="utf-8")
        self.assertEqual(surface.load_lock(lock_file)["source_commit"], self.sha)
        self.lock["visual_source_paths"] = ["system/surface/runtime"]
        lock_file.write_text(json.dumps(self.lock), encoding="utf-8")
        with self.assertRaisesRegex(surface.SurfaceSourceError, "public mount boundary"):
            surface.load_lock(lock_file)


if __name__ == "__main__":
    unittest.main()
