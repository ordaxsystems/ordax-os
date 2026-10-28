"""Cross-repository source lock advancement must stay one-way, immutable and owner-scoped."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from tools.source_integration_test_adapter import advance_module

# The production helper lives in tools/source-integration (hyphenated path).
advance = advance_module()


class SourceAdvanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "os"
        self.source = Path(self.tmp.name) / "upstream"
        (self.root / "docs/contracts").mkdir(parents=True)
        self.source.mkdir()
        for name in ("surface", "intelligence"):
            relative = advance.OWNERS[name]["module"]
            dest = self.root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(advance.ROOT / relative, dest)
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "source-sync-test")
        self.git("config", "user.email", "source-sync@example.invalid")

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.source), *args], stderr=subprocess.PIPE
        ).decode().strip()

    def write(self, path, text):
        target = self.source / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, message="fixture"):
        self.git("add", ".")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def lock(self, owner, data):
        path = self.root / advance.OWNERS[owner]["lock"]
        path.write_text(json.dumps(data, indent=2) + "\n")
        return path

    def test_surface_only_visual_changes_advance_and_keep_policy(self):
        self.write("system/surface/ui/index.js", "old")
        self.write("system/surface/workspace/index.js", "old")
        original = self.commit()
        path = self.lock("surface", {
            "$schema": "prototype-ordax.surface-source/1",
            "status": "canonical",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": original,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
            "physical_disk_write_allowed": False,
        })
        self.write("README.md", "docs only")
        self.commit()
        self.assertEqual(advance.advance(self.root, "surface", self.source, True)["reason"], "no-owned-source-change")
        self.assertEqual(json.loads(path.read_text())["source_commit"], original)
        self.write("system/surface/ui/index.js", "new")
        new = self.commit()
        self.assertTrue(advance.advance(self.root, "surface", self.source)["changed"])
        self.assertEqual(json.loads(path.read_text())["source_commit"], original)
        self.assertTrue(advance.advance(self.root, "surface", self.source, True)["changed"])
        updated = json.loads(path.read_text())
        self.assertEqual(updated["source_commit"], new)
        self.assertIs(updated["physical_disk_write_allowed"], False)
        self.assertFalse(advance.advance(self.root, "surface", self.source, True)["changed"])
        self.git("checkout", "--detach", original)
        with self.assertRaisesRegex(advance.SourceAdvanceError, "does not descend"):
            advance.advance(self.root, "surface", self.source, True)

    def test_intelligence_updates_exact_eight_blobs_without_activation(self):
        paths = (
            "src/index.mjs",
            "src/contract-bindings.mjs",
            "src/intelligence/runtime.mjs",
            "src/intelligence/model-router.mjs",
            "src/local-ai/runtime.mjs",
            "src/local-ai/completion-stream.mjs",
            "src/local-ai/model-compatibility.mjs",
            "tools/inference-builder/build.py",
        )
        for relative in paths:
            self.write(relative, "old source")
        original = self.commit()
        blobs = {name: self.git("rev-parse", "HEAD:" + name) for name in paths}
        path = self.lock("intelligence", {
            "$schema": "prototype-ordax.intelligence-source/1",
            "status": "integration-candidate",
            "source_repository": "ordaxsystems/ordax-intelligence",
            "source_commit": original,
            "source_paths": blobs,
            "materialization_target": "system/intelligence-source/src",
            "public_ports": ["ordax.intelligence/1", "ordax.model-router/1", "ordax.local-ai/1"],
            "source_only": True,
            "change_live_os": False,
            "activation_authorized": False,
            "cutover_complete": False,
        })
        self.write("src/local-ai/runtime.mjs", "new source")
        new = self.commit()
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])
        updated = json.loads(path.read_text())
        self.assertEqual(updated["source_commit"], new)
        self.assertEqual(updated["source_paths"]["src/local-ai/runtime.mjs"], self.git("rev-parse", "HEAD:src/local-ai/runtime.mjs"))
        self.assertEqual(updated["source_paths"]["src/index.mjs"], blobs["src/index.mjs"])
        self.assertEqual(updated["status"], "integration-candidate")
        self.assertIs(updated["activation_authorized"], False)
        self.assertIs(updated["cutover_complete"], False)
        self.write("tools/inference-builder/windows-candidate.py", "Windows-only optional builder")
        self.commit()
        unrelated = advance.advance(self.root, "intelligence", self.source, True)
        self.assertFalse(unrelated["changed"])
        self.assertEqual(unrelated["reason"], "no-owned-source-change")
        self.assertEqual(json.loads(path.read_text())["source_commit"], new)
        # The Windows-only builder remains outside the eight-blob OS source
        # graph, even when a later pinned blob changes legitimately.
        self.write("src/local-ai/runtime.mjs", "new version 2")
        later = self.commit()
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])
        final = json.loads(path.read_text())
        self.assertEqual(final["source_commit"], later)
        self.assertEqual(set(final["source_paths"]), set(paths))
        self.assertNotIn("tools/inference-builder/windows-candidate.py", final["source_paths"])

    def test_reject_source_symlink(self):
        linked = Path(self.tmp.name) / "linked"
        linked.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(advance.SourceAdvanceError, "real Git checkout"):
            advance.advance(self.root, "surface", linked, True)


if __name__ == "__main__":
    unittest.main()
