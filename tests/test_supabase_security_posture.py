import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "supabase-security-posture.json"
SYNC_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261005025500_sync_private_least_privilege_v2.sql"
)
NETWORK_EXECUTOR_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261005033000_private_domain_executors_v1.sql"
)
MEMORY_CONTRACT = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"


class SupabaseSecurityPostureTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_external_security_warnings_are_not_hidden_or_auto_silenced(self):
        self.assertEqual(
            self.contract["status"],
            "reviewed-warnings-present-public-rollout-blocked",
        )
        self.assertFalse(self.contract["public_account_activation_allowed"])
        self.assertFalse(self.contract["automatic_advisor_silencing_allowed"])
        self.assertFalse(
            self.contract["permissive_policy_creation_to_silence_linter_allowed"]
        )
        self.assertFalse(self.contract["blanket_security_definer_execute_revoke_allowed"])

        advisor = self.contract["advisor"]
        self.assertEqual(advisor["rls_enabled_no_policy"]["level"], "INFO")
        self.assertEqual(advisor["rls_enabled_no_policy"]["count"], 72)
        self.assertFalse(advisor["rls_enabled_no_policy"]["review_complete"])
        self.assertFalse(advisor["rls_enabled_no_policy"]["auto_fix_allowed"])

        definers = advisor["authenticated_security_definer_function_executable"]
        self.assertEqual(definers["level"], "WARN")
        self.assertEqual(definers["count"], 31)
        self.assertEqual(definers["reviewed_count"], 31)
        self.assertEqual(definers["pending_count"], 0)
        self.assertEqual(
            definers["reviewed_count"] + definers["pending_count"],
            definers["count"],
        )
        self.assertTrue(definers["review_complete"])
        self.assertFalse(definers["blanket_revoke_allowed"])

        leaked = advisor["auth_leaked_password_protection"]
        self.assertEqual(leaked["level"], "WARN")
        self.assertEqual(leaked["count"], 1)
        self.assertFalse(leaked["provider_setting_enabled"])
        self.assertFalse(leaked["product_gateway_hibp_is_provider_setting_substitute"])
        self.assertTrue(leaked["blocks_public_identity_activation"])

    def test_reviewed_definer_counts_are_domain_explicit(self):
        reviewed = self.contract["reviewed_security_definer_boundaries"]
        reviewed_warns = sum(
            reviewed[name]["warn_count"]
            for name in ("account_export", "cloud_memory", "account_sync", "network")
        )
        self.assertEqual(reviewed_warns, 31)

        account = reviewed["account_export"]
        self.assertTrue(account["authenticated_execute_intentional"])
        self.assertTrue(account["owner_bound_by_auth_uid"])
        self.assertTrue(account["search_path_pinned_empty"])
        self.assertFalse(account["cross_subject_reads_allowed"])

        memory = reviewed["cloud_memory"]
        self.assertTrue(memory["authenticated_execute_intentional"])
        self.assertTrue(memory["owner_bound_by_auth_uid"])
        self.assertTrue(memory["space_access_server_verified"])
        self.assertTrue(memory["entitlement_server_verified"])
        self.assertFalse(memory["api_roles_direct_private_helper_execute_allowed"])

        sync = reviewed["account_sync"]
        self.assertTrue(sync["authenticated_execute_intentional"])
        self.assertTrue(sync["owner_bound_by_auth_uid"])
        self.assertFalse(sync["direct_private_relation_authority_for_api_roles"])
        self.assertFalse(sync["executor_login_allowed"])
        self.assertFalse(sync["executor_bypass_rls_allowed"])

        network = reviewed["network"]
        self.assertEqual(network["warn_count"], 23)
        self.assertEqual(network["public_wrapper_count"], 23)
        self.assertEqual(network["public_wrapper_authorization_chain_proven_count"], 23)
        self.assertTrue(network["all_public_wrappers_map_to_authorized_private_target"])
        self.assertEqual(network["private_helper_count"], 32)
        self.assertTrue(network["public_wrappers_owned_by_executor"])
        self.assertTrue(network["public_wrappers_search_path_pinned_empty"])
        self.assertFalse(network["public_wrappers_anon_execute"])
        self.assertTrue(network["public_wrappers_authenticated_execute"])
        self.assertTrue(network["public_wrappers_service_role_execute"])
        self.assertTrue(network["private_helpers_security_definer"])
        self.assertTrue(network["private_helpers_search_path_pinned_empty"])
        self.assertTrue(network["private_helpers_executor_execute"])
        self.assertFalse(network["api_roles_direct_private_helper_execute_allowed"])
        self.assertFalse(network["executor_login_allowed"])
        self.assertFalse(network["executor_inherit_allowed"])
        self.assertFalse(network["executor_bypass_rls_allowed"])
        self.assertFalse(network["executor_superuser_allowed"])
        self.assertFalse(network["executor_create_db_allowed"])
        self.assertFalse(network["executor_create_role_allowed"])
        self.assertFalse(network["executor_replication_allowed"])
        self.assertFalse(network["executor_direct_table_grants"])
        self.assertFalse(network["executor_owned_relations"])
        self.assertFalse(network["executor_public_schema_create"])
        self.assertFalse(network["blanket_revoke_allowed"])

    def test_reviewed_boundaries_are_backed_by_current_source_contracts(self):
        sync_sql = SYNC_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create role ordax_sync_executor", sync_sql)
        self.assertIn("nologin", sync_sql)
        self.assertIn("nobypassrls", sync_sql)
        self.assertIn(
            "grant execute on function public.ordax_account_export_v1() to authenticated;",
            sync_sql,
        )
        self.assertIn(
            "auth.uid()",
            "\n".join(
                (ROOT / path).read_text(encoding="utf-8").lower()
                for path in (
                    "infra/supabase/product/migrations/20260925004832_account_sync_private_store_v1.sql",
                    "infra/supabase/product/migrations/20260925031000_account_data_export_v1.sql",
                )
            ),
        )

        memory = json.loads(MEMORY_CONTRACT.read_text(encoding="utf-8"))
        impl = memory["implementation"]
        self.assertEqual(impl["security_mode"], "domain-executor-definer-wrapper")
        self.assertEqual(impl["public_wrapper_owner"], "ordax_memory_executor")
        self.assertTrue(impl["authenticated_authority_limited_to_public_wrapper"])
        self.assertFalse(impl["api_roles_direct_private_helper_execute_allowed"])

        network_sql = NETWORK_EXECUTOR_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create role ordax_network_executor", network_sql)
        self.assertIn("nosuperuser", network_sql)
        self.assertIn("noinherit", network_sql)
        self.assertIn("nologin", network_sql)
        self.assertIn("nobypassrls", network_sql)
        self.assertIn("network executor can execute unexpected private function", network_sql)
        self.assertIn("api role still executes private domain helper", network_sql)
        self.assertIn("direct table grant detected", network_sql)
        self.assertIn("executor owns relation", network_sql)
        self.assertIn("create privilege leaked", network_sql)
        self.assertIn("to authenticated, service_role", network_sql)

    def test_public_auth_rate_limit_is_not_misclassified_as_authenticated_warning(self):
        rate_limit = self.contract["reviewed_security_definer_boundaries"][
            "public_auth_rate_limit"
        ]
        self.assertFalse(rate_limit["advisor_warn_member"])
        self.assertTrue(rate_limit["security_definer"])
        self.assertFalse(rate_limit["authenticated_execute"])
        self.assertFalse(rate_limit["anon_execute"])
        self.assertTrue(rate_limit["service_role_execute"])

    def test_security_definer_domain_review_is_complete_but_rollout_stays_blocked(self):
        self.assertEqual(self.contract["pending_security_definer_domains"], {})
        gate = self.contract["activation_gate"]
        self.assertTrue(gate["advisor_external_warns_must_be_resolved_or_explicitly_reviewed"])
        self.assertTrue(gate["security_definer_review_complete"])
        self.assertEqual(gate["pending_security_definer_domain_count"], 0)
        self.assertTrue(gate["provider_leaked_password_setting_must_be_resolved"])
        self.assertTrue(
            gate["rls_info_findings_require_domain_classification_not_permissive_policies"]
        )
        self.assertFalse(gate["current_public_activation"])

    def test_structured_contract_explicitly_supersedes_stale_snapshot_key(self):
        self.assertIn(
            "SUPABASE_SECURITY_ADVISOR_RLS_NO_POLICY",
            self.contract["supersedes_current_state_keys"],
        )
        self.assertTrue(self.contract["current_state_snapshot_reconciliation_pending"])


if __name__ == "__main__":
    unittest.main()
