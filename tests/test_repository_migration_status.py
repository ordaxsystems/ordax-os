import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUS = ROOT / "docs" / "contracts" / "repository-migration-status.json"

class RepositoryMigrationStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.status = json.loads(STATUS.read_text(encoding="utf-8"))

    def test_four_canonical_repositories(self):
        repos = self.status["canonical_repositories"]
        self.assertEqual(set(repos), {"platform", "apps", "runtime", "control_plane"})

    def test_legacy_delete_gate_is_fail_closed(self):
        gates = self.status["gates"]
        prerequisites = [
            "studio_portable_canonical_in_ordax_apps",
            "studio_version_authority_in_ordax_apps",
            "runtime_canonical_in_ordax_runtime",
            "runtime_windows_build_repointed",
            "control_plane_canonical_in_ordax_control_plane",
            "provider_connector_repointed",
            "production_deploy_repointed",
            "windows_packaging_repointed",
            "chatgpt_control_plane_runtime_e2e_green",
            "no_functional_legacy_build_deploy_launch_reference",
        ]
        expected = all(gates[name] is True for name in prerequisites)
        self.assertEqual(gates["safe_to_delete_legacy_repository"], expected)

    def test_current_migration_state_matches_known_cutover(self):
        gates = self.status["gates"]
        self.assertTrue(gates["studio_portable_canonical_in_ordax_apps"])
        self.assertTrue(gates["studio_version_authority_in_ordax_apps"])
        self.assertTrue(gates["runtime_canonical_in_ordax_runtime"])
        self.assertTrue(gates["runtime_windows_build_repointed"])
        self.assertTrue(gates["control_plane_canonical_in_ordax_control_plane"])
        self.assertTrue(gates["provider_connector_repointed"])
        self.assertTrue(gates["windows_packaging_repointed"])
        self.assertFalse(gates["production_deploy_repointed"])
        self.assertTrue(gates["chatgpt_control_plane_runtime_e2e_green"])
        self.assertFalse(gates["safe_to_delete_legacy_repository"])

if __name__ == "__main__":
    unittest.main()
