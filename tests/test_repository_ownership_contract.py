import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "repository-ownership.json"

class RepositoryOwnershipContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_four_canonical_repositories(self):
        repos = self.contract["repositories"]
        self.assertEqual(set(repos), {"platform", "apps", "runtime", "control_plane"})
        self.assertEqual(repos["platform"]["repo"], "ordaxsystems/prototipo-ordax-os")
        self.assertEqual(repos["apps"]["repo"], "ordaxsystems/ordax-apps")
        self.assertEqual(repos["runtime"]["repo"], "ordaxsystems/ordax-runtime")
        self.assertEqual(repos["control_plane"]["repo"], "ordaxsystems/ordax-platform")

    def test_studio_runtime_and_control_plane_have_distinct_owners(self):
        repos = self.contract["repositories"]
        self.assertIn("studio-portable-source", repos["apps"]["owns"])
        self.assertIn("windows-ordax-runtime", repos["runtime"]["owns"])
        self.assertIn("product-mcp", repos["control_plane"]["owns"])
        self.assertIn("app-sdk", repos["platform"]["owns"])

    def test_legacy_repo_is_retirement_only(self):
        legacy = self.contract["legacy"]
        self.assertEqual(legacy["repo"], "washingtonmsdj/mcp-blender")
        self.assertEqual(legacy["role"], "incubation-legacy-retirement-only")
        self.assertFalse(legacy["new_features_allowed"])
        self.assertGreaterEqual(len(legacy["delete_only_after"]), 6)

    def test_security_and_ssot_invariants(self):
        invariants = self.contract["invariants"]
        for key, value in invariants.items():
            self.assertTrue(value, key)

    def test_no_duplicate_canonical_ownership_for_key_boundaries(self):
        repos = self.contract["repositories"]
        ownership = {}
        for name, data in repos.items():
            for item in data["owns"]:
                self.assertNotIn(item, ownership, f"{item} duplicated by {ownership.get(item)} and {name}")
                ownership[item] = name

if __name__ == "__main__":
    unittest.main()
