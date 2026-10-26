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
            "authenticated_private_schema_usage": False,
            "authenticated_private_function_execute": 0,
            "private_cloud_storage_rls_enabled_count": 2,
            "authenticated_sync_table_grants": 0,
            "service_role_sync_table_grants": 0,
            "sync_policy_count": 6,
            "unexpected_sync_policy_count": 0,
            "service_role_user_sync_rpc_execute": 0,
            "app_role_sync_sequence_privilege": False,
            "unexpected_authenticated_write_grants": [],
        }

    def test_target_boundary_is_ready(self):
        proof = MODULE.evaluate(self.valid_observation())
        self.assertEqual(proof["$schema"], "prototype-ordax.control-plane-privilege-proof/4")
        self.assertTrue(proof["ready"])
        self.assertEqual(proof["project_ref"], "redacted")
        self.assertTrue(all(proof["checks"].values()))

    def test_anon_or_public_execute_blocks(self):
        observed = self.valid_observation()
        observed["anon_function_execute"] = 1
        observed["public_function_execute"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["no_anon_function_execute"])
        self.assertFalse(proof["checks"]["no_public_function_execute"])

    def test_unsafe_security_definer_search_path_blocks(self):
        observed = self.valid_observation()
        observed["unsafe_security_definer_search_path"] = 1
        self.assertFalse(MODULE.evaluate(observed)["checks"]["security_definer_search_path"])

    def test_any_authenticated_write_blocks(self):
        observed = self.valid_observation()
        observed["unexpected_authenticated_write_grants"] = [
            {"schema": "public", "table": "ordax_accounts", "privilege": "UPDATE"}
        ]
        self.assertFalse(MODULE.evaluate(observed)["checks"]["no_unexpected_authenticated_write_grants"])

    def test_direct_authenticated_sync_table_grant_blocks_even_when_read_only(self):
        observed = self.valid_observation()
        observed["authenticated_sync_table_grants"] = 1
        self.assertFalse(MODULE.evaluate(observed)["checks"]["no_authenticated_sync_table_grants"])

    def test_service_role_sync_authority_blocks(self):
        observed = self.valid_observation()
        observed["service_role_sync_table_grants"] = 1
        observed["service_role_user_sync_rpc_execute"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["no_service_role_sync_table_grants"])
        self.assertFalse(proof["checks"]["no_service_role_user_sync_rpc_execute"])

    def test_export_policy_is_authorized_but_unauthorized_extra_is_rejected(self):
        self.assertIn(
            ("ordax_sync_objects", "ordax_sync_objects_export_own", "ordax_account_export_executor"),
            MODULE.EXPECTED_SYNC_POLICIES,
        )
        for text in ("ordax_sync_objects_export_own", "ordax_account_export_executor"):
            self.assertIn(text, MODULE.SQL)
        self.assertEqual(len(MODULE.EXPECTED_SYNC_POLICIES), 6)
        self.assertNotIn("EXACT_SYNC_POLICIES", MODULE.SQL)
        bad = self.valid_observation()
        bad["unexpected_sync_policy_count"] = 1
        self.assertFalse(MODULE.evaluate(bad)["checks"]["sync_policies_executor_only"])

    def test_live_target_rejects_other_projects_and_unknown_hosts(self):
        ref = "a" * 20
        MODULE.validate_database_target("postgresql://postgres@db." + ref + ".supabase.co:5432/postgres", ref)
        MODULE.validate_database_target("postgresql://postgres." + ref + "@aws-0-sa-east-1.pooler.supabase.com:5432/postgres", ref)
        for uri in (
            "postgresql://postgres@db." + "b"*20 + ".supabase.co/postgres",
            "postgresql://postgres@evil.example/postgres",
            "postgresql://postgres." + "b"*20 + "@aws-0-sa-east-1.pooler.supabase.com/postgres",
        ):
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                MODULE.validate_database_target(uri, ref)

    def test_sync_policies_must_be_exact_executor_only_set(self):
        observed = self.valid_observation()
        observed["unexpected_sync_policy_count"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["sync_policies_executor_only"])

        observed = self.valid_observation()
        observed["sync_policy_count"] = 4
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["sync_policies_executor_only"])

    def test_sync_sequence_must_not_be_exposed_to_application_roles(self):
        observed = self.valid_observation()
        observed["app_role_sync_sequence_privilege"] = True
        self.assertFalse(MODULE.evaluate(observed)["checks"]["no_app_role_sync_sequence_privilege"])

    def test_authenticated_private_surface_blocks_release(self):
        observed = self.valid_observation()
        observed["authenticated_private_schema_usage"] = True
        observed["authenticated_private_function_execute"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["no_authenticated_private_schema_usage"])
        self.assertFalse(proof["checks"]["no_authenticated_private_function_execute"])

    def test_private_cloud_storage_requires_rls_on_both_tables(self):
        observed = self.valid_observation()
        observed["private_cloud_storage_rls_enabled_count"] = 1
        proof = MODULE.evaluate(observed)
        self.assertFalse(proof["checks"]["private_cloud_storage_rls_enabled"])

    def test_anon_private_schema_usage_blocks(self):
        observed = self.valid_observation()
        observed["anon_private_schema_usage"] = True
        self.assertFalse(MODULE.evaluate(observed)["checks"]["no_anon_private_schema_usage"])


if __name__ == "__main__":
    unittest.main()
