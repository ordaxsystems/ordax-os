import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "public-site" / "require_account_release_ready.py"
SPEC = importlib.util.spec_from_file_location("require_account_release_ready_db", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AccountReleaseDatabaseProofTests(unittest.TestCase):
    def valid_proof(self):
        return {
            "$schema": "prototype-ordax.control-plane-privilege-proof/3",
            "provider": "supabase-postgres",
            "project_ref": "redacted",
            "checks": {
                "no_anon_table_grants": True,
                "no_anon_function_execute": True,
                "no_public_function_execute": True,
                "security_definer_search_path": True,
                "no_anon_private_schema_usage": True,
                "private_cloud_storage_rls_enabled": True,
                "no_authenticated_sync_table_grants": True,
                "no_service_role_sync_table_grants": True,
                "sync_policies_executor_only": True,
                "no_service_role_user_sync_rpc_execute": True,
                "no_app_role_sync_sequence_privilege": True,
                "no_unexpected_authenticated_write_grants": True,
                "no_authenticated_private_schema_usage": True,
                "no_authenticated_private_function_execute": True,
            },
            "observed": {
                "anon_table_grant_count": 0,
                "anon_function_execute_count": 0,
                "public_function_execute_count": 0,
                "unsafe_security_definer_search_path_count": 0,
                "anon_private_schema_usage": False,
                "authenticated_private_schema_usage": False,
                "authenticated_private_function_execute_count": 0,
                "private_cloud_storage_rls_enabled_count": 2,
                "authenticated_sync_table_grant_count": 0,
                "service_role_sync_table_grant_count": 0,
                "sync_policy_count": 5,
                "non_executor_sync_policy_count": 0,
                "service_role_user_sync_rpc_execute_count": 0,
                "app_role_sync_sequence_privilege": False,
                "unexpected_authenticated_write_grant_count": 0,
            },
            "ready": True,
        }

    def test_valid_sanitized_database_proof_passes(self):
        self.assertEqual(MODULE.validate_database_proof(self.valid_proof()), [])

    def test_public_execute_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["no_public_function_execute"] = False
        proof["observed"]["public_function_execute_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-no_public_function_execute", blockers)
        self.assertIn("database-proof-public_function_execute_count", blockers)
        self.assertIn("database-proof-not-ready", blockers)

    def test_direct_authenticated_sync_grant_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["no_authenticated_sync_table_grants"] = False
        proof["observed"]["authenticated_sync_table_grant_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-no_authenticated_sync_table_grants", blockers)
        self.assertIn("database-proof-authenticated_sync_table_grant_count", blockers)

    def test_service_role_sync_authority_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["no_service_role_sync_table_grants"] = False
        proof["checks"]["no_service_role_user_sync_rpc_execute"] = False
        proof["observed"]["service_role_sync_table_grant_count"] = 1
        proof["observed"]["service_role_user_sync_rpc_execute_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-no_service_role_sync_table_grants", blockers)
        self.assertIn("database-proof-no_service_role_user_sync_rpc_execute", blockers)
        self.assertIn("database-proof-service_role_sync_table_grant_count", blockers)
        self.assertIn("database-proof-service_role_user_sync_rpc_execute_count", blockers)

    def test_non_executor_policy_or_sequence_authority_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["sync_policies_executor_only"] = False
        proof["checks"]["no_app_role_sync_sequence_privilege"] = False
        proof["observed"]["non_executor_sync_policy_count"] = 1
        proof["observed"]["app_role_sync_sequence_privilege"] = True
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-sync_policies_executor_only", blockers)
        self.assertIn("database-proof-no_app_role_sync_sequence_privilege", blockers)
        self.assertIn("database-proof-non_executor_sync_policy_count", blockers)
        self.assertIn("database-proof-app-role-sync-sequence-privilege", blockers)

    def test_missing_sync_policy_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["sync_policies_executor_only"] = False
        proof["observed"]["sync_policy_count"] = 4
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-sync_policies_executor_only", blockers)
        self.assertIn("database-proof-sync_policy_count", blockers)

    def test_private_application_surface_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["no_authenticated_private_schema_usage"] = False
        proof["checks"]["no_authenticated_private_function_execute"] = False
        proof["observed"]["authenticated_private_schema_usage"] = True
        proof["observed"]["authenticated_private_function_execute_count"] = 2
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-no_authenticated_private_schema_usage", blockers)
        self.assertIn("database-proof-no_authenticated_private_function_execute", blockers)
        self.assertIn("database-proof-authenticated-private-schema-usage", blockers)
        self.assertIn("database-proof-authenticated_private_function_execute_count", blockers)

    def test_private_cloud_storage_rls_gap_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["private_cloud_storage_rls_enabled"] = False
        proof["observed"]["private_cloud_storage_rls_enabled_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-private_cloud_storage_rls_enabled", blockers)
        self.assertIn("database-proof-private_cloud_storage_rls_enabled_count", blockers)

    def test_boolean_counts_must_not_pass_as_integer_zero_or_expected_policy_count(self):
        proof = self.valid_proof()
        proof["observed"]["anon_table_grant_count"] = False
        proof["observed"]["sync_policy_count"] = True
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-observation-type-anon_table_grant_count", blockers)
        self.assertIn("database-proof-observation-type-sync_policy_count", blockers)

    def test_extra_evidence_fields_are_rejected_instead_of_persisted(self):
        proof = self.valid_proof()
        proof["observed"]["unreviewed_extra"] = {"secret": "must-not-persist"}
        proof["opaque_secrets"] = "must-not-persist"
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-observation-set", blockers)
        self.assertIn("database-proof-field-set", blockers)

    def test_database_proof_must_be_sanitized_and_exact(self):
        proof = self.valid_proof()
        proof["project_ref"] = "must-not-be-persisted"
        proof["checks"]["extra"] = True
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-not-sanitized", blockers)
        self.assertIn("database-proof-check-set", blockers)


if __name__ == "__main__":
    unittest.main()
