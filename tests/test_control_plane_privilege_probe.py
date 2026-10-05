import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "security" / "probe_control_plane_privileges.py"
SPEC = importlib.util.spec_from_file_location("probe_control_plane_privileges", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ControlPlanePrivilegeProbeTests(unittest.TestCase):
    def valid_observation(self):
        return {
            "anon_table_grants": 0,
            "anon_function_execute": 0,
            "public_function_execute": 0,
            "unsafe_security_definer_search_path": 0,
            "anon_private_schema_usage": False,
            "unexpected_authenticated_write_grants": [],
            "allowed_authenticated_write_grants_present": 3,
        }

    def test_current_expected_boundary_is_ready(self):
        proof = MODULE.evaluate(self.valid_observation())
        self.assertTrue(proof["ready"])
        self.assertEqual(proof["project_ref"], "redacted")
        self.assertTrue(all(proof["checks"].values()))

    def test_anon_or_public_execute_blocks(self):
        observed = self.valid_observation()
        observed["anon_function_execute"] = 1
        observed["public_function_execute"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["ready"])
        self.assertFalse(proof["checks"]["no_anon_function_execute"])
        self.assertFalse(proof["checks"]["no_public_function_execute"])

    def test_unsafe_security_definer_search_path_blocks(self):
        observed = self.valid_observation()
        observed["unsafe_security_definer_search_path"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["security_definer_search_path"])

    def test_unexpected_authenticated_write_blocks(self):
        observed = self.valid_observation()
        observed["unexpected_authenticated_write_grants"] = [
            {"schema": "public", "table": "ordax_accounts", "privilege": "UPDATE"}
        ]
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["authenticated_write_allowlist"])

    def test_missing_expected_sync_write_grant_blocks(self):
        observed = self.valid_observation()
        observed["allowed_authenticated_write_grants_present"] = 2
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["authenticated_write_allowlist"])

    def test_anon_private_schema_usage_blocks(self):
        observed = self.valid_observation()
        observed["anon_private_schema_usage"] = True
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["no_anon_private_schema_usage"])


if __name__ == "__main__":
    unittest.main()
