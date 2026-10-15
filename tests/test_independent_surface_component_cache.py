import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/independent_surface_component_cache.py"


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


if __name__ == "__main__":
    unittest.main()
