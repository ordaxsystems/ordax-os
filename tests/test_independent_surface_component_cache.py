import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/independent_surface_component_cache.py"
WORKFLOW = ROOT / ".github/workflows/independent-surface-runtime.yml"


def load_module():
    name = "independent_surface_component_cache"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class IndependentSurfaceComponentCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def setUp(self):
        self.old_env = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT")
        os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "test/linux-x86_64/image-v1"

    def tearDown(self):
        if self.old_env is None:
            os.environ.pop("ORDAX_COMPONENT_CACHE_ENVIRONMENT", None)
        else:
            os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = self.old_env

    def make_root(self, base: Path) -> Path:
        for relative in self.mod.INPUTS:
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(relative + "\n", encoding="utf-8")
        return base

    def make_output(self, base: Path, commit: str) -> Path:
        base.mkdir(parents=True)
        (base / "native-surface-runtime-buildroot.erofs").write_bytes(b"erofs-bytes")
        (base / "provenance.json").write_text(json.dumps({
            "$schema": "prototype-ordax.independent-surface-runtime-provenance/1",
            "source_commit": commit,
        }) + "\n", encoding="utf-8")
        return base

    def test_fingerprint_tracks_only_build_inputs(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_root(Path(td) / "repo")
            first = self.mod.fingerprint(root)
            (root / "README.md").write_text("docs\n", encoding="utf-8")
            self.assertEqual(first, self.mod.fingerprint(root))
            target = root / self.mod.INPUTS[0]
            target.write_text("changed\n", encoding="utf-8")
            self.assertNotEqual(first, self.mod.fingerprint(root))

    def test_reuse_preserves_original_provenance_and_binds_new_commit(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            original = (out / "provenance.json").read_bytes()
            receipt = self.mod.verify(
                out,
                "2" * 40,
                temp / "receipt.json",
                cache_hit=True,
                root=root,
            )
            self.assertTrue(receipt["reused"])
            self.assertEqual(receipt["build_source_commit"], "1" * 40)
            self.assertEqual(receipt["integration_source_commit"], "2" * 40)
            self.assertFalse(receipt["provenance_rewritten"])
            self.assertEqual((out / "provenance.json").read_bytes(), original)

    def test_fresh_build_must_match_current_commit(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            with self.assertRaisesRegex(self.mod.CacheError, "integration commit"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=False,
                    root=root,
                )

    def test_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            (out / "native-surface-runtime-buildroot.erofs").write_bytes(b"tampered")
            with self.assertRaisesRegex(self.mod.CacheError, "bytes changed"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=True,
                    root=root,
                )

    def test_workflow_uses_one_durable_content_addressed_surface_store(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("ORDAX_R2_BUCKET: 'ordax-device-artifacts'", workflow)
        self.assertIn("prefix='ci/surface-runtime/v1'", workflow)
        self.assertIn("/manifests/${ORDAX_SURFACE_FINGERPRINT}.json", workflow)
        self.assertIn("/blobs/sha256/${digest}", workflow)
        self.assertNotIn("r2.dev", workflow)

    def test_workflow_keeps_github_cache_fast_but_r2_durable(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Restore verified Independent Surface EROFS component", workflow)
        self.assertIn("Restore verified Independent Surface EROFS from durable R2 store", workflow)
        self.assertIn("Save verified Independent Surface EROFS component in fast GitHub cache", workflow)
        self.assertIn("Publish fresh verified Surface to durable R2 store", workflow)
        self.assertIn("artifact_reused: ${{ steps.surface-reuse-state.outputs.reused }}", workflow)
        self.assertIn("if: needs.buildroot-surface.outputs.artifact_reused != 'true'", workflow)

    def test_expensive_surface_build_requires_both_fast_and_durable_miss(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        marker = "      - name: Build Buildroot/musl Surface runtime on durable artifact miss\n"
        start = workflow.index(marker)
        end = workflow.find("\n      - name: ", start + len(marker))
        block = workflow[start:end]
        self.assertIn("steps.surface-artifact-cache.outputs.cache-hit != 'true'", block)
        self.assertIn("steps.surface-r2.outputs.hit != 'true'", block)

    def test_durable_publication_is_immutable_and_credentials_are_not_hardcoded(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("--header 'If-None-Match: *'", workflow)
        self.assertIn("secrets.ORDAX_R2_ACCESS_KEY_ID", workflow)
        self.assertIn("secrets.ORDAX_R2_SECRET_ACCESS_KEY", workflow)
        self.assertNotRegex(workflow, r"ORDAX_R2_(ACCESS_KEY_ID|SECRET_ACCESS_KEY): '[^']+'")
        self.assertIn("refusing overwrite", workflow)


if __name__ == "__main__":
    unittest.main()
