from pathlib import Path
import importlib.util
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/independent_surface_impact.py"


def load_module():
    name = "independent_surface_impact"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class IndependentSurfaceImpactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_real_surface_byte_owners_are_heavy(self):
        for path in (
            "bootstrap/independent-surface-runtime/build.py",
            "bootstrap/independent-surface-runtime/prepare_config.py",
            "bootstrap/independent-surface-runtime/source.json",
            "bootstrap/independent-surface-runtime/configs/ordax_surface_defconfig",
            "bootstrap/independent-base/source.json",
            "bootstrap/kernel/source.json",
        ):
            with self.subTest(path=path):
                result = self.mod.classify_paths([path])
                self.assertTrue(result.required)

    def test_contract_docs_and_ci_only_changes_are_light(self):
        result = self.mod.classify_paths([
            "bootstrap/independent-surface-runtime/README.md",
            "tests/test_independent_surface_runtime.py",
            "tests/test_independent_surface_qemu_binding.py",
            "tests/test_independent_surface_impact.py",
            ".github/workflows/independent-surface-runtime.yml",
            ".github/workflows/portable-v2-qemu-boot-proof.yml",
            "docs/contracts/ci-supply-chain.json",
            "tools/ci/independent_surface_impact.py",
        ])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("contract-only",))

    def test_unknown_path_fails_closed(self):
        result = self.mod.classify_paths(["bootstrap/something-new/runtime.py"])
        self.assertTrue(result.required)
        self.assertIn("unclassified:bootstrap/something-new/runtime.py", result.reasons)

    def test_no_change_is_light(self):
        result = self.mod.classify_paths([])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-changes",))


if __name__ == "__main__":
    unittest.main()
