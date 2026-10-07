import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "repository-ownership.json"


class RepositoryNamespaceMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = json.loads(CONTRACT.read_text(encoding="utf-8"))["namespace_migration"]

    def test_target_namespace_and_order(self):
        self.assertEqual(self.migration["current_namespace"], "washingtonmsdj")
        self.assertEqual(self.migration["status"], "in-progress")
        self.assertEqual(self.migration["target_namespace"], "ordaxsystems")
        self.assertEqual(
            self.migration["cutover_order"],
            ["runtime", "apps", "control_plane", "platform"],
        )
        self.assertEqual(self.migration["completed_transfers"], ["runtime"])

    def test_cutover_is_single_authority(self):
        self.assertFalse(self.migration["redirect_dependency_allowed"])
        self.assertFalse(self.migration["mirror_repository_allowed"])
        self.assertFalse(self.migration["dual_authority_allowed"])
        self.assertFalse(self.migration["repository_name_changes_during_transfer"])
        self.assertFalse(self.migration["provenance_rewrite_allowed"])
        self.assertTrue(
            self.migration["transfer_policy"].startswith("transfer-one-repository")
        )


if __name__ == "__main__":
    unittest.main()
