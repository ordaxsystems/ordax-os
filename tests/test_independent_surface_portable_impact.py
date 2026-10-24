from pathlib import Path
import importlib.util
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/portable_qemu_impact.py"


def load_module():
    name = "portable_qemu_impact_independent_surface"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class IndependentSurfacePortableImpactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_independent_base_source_contract_remains_heavy(self):
        result = self.mod.classify_paths(["bootstrap/independent-base/source.json"])
        self.assertTrue(result.required)
        self.assertEqual(
            result.reasons,
            ("independent-base-source-contract:bootstrap/independent-base/source.json",),
        )

    def test_independent_base_non_source_files_remain_producer_neutral(self):
        result = self.mod.classify_paths(["bootstrap/independent-base/README.md"])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_independent_surface_byte_owners_are_delegated_to_candidate_workflow(self):
        result = self.mod.classify_paths([
            "bootstrap/independent-surface-runtime/build.py",
            "bootstrap/independent-surface-runtime/source.json",
        ])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_independent_surface_workflow_policy_does_not_duplicate_qemu(self):
        result = self.mod.classify_paths([
            ".github/workflows/independent-surface-runtime.yml",
        ])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_unrelated_unknown_non_system_path_still_fails_closed(self):
        result = self.mod.classify_paths(["bootstrap/unclassified-runtime/source.json"])
        self.assertTrue(result.required)
        self.assertEqual(
            result.reasons,
            ("heavy-non-system:bootstrap/unclassified-runtime/source.json",),
        )


if __name__ == "__main__":
    unittest.main()
