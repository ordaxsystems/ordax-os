import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDENTITY_CONTRACT = ROOT / "docs" / "contracts" / "public-identity.json"
SERVICE_README = ROOT / "services" / "public-identity" / "README.md"
SUPABASE_ROOT = ROOT / "infra" / "supabase" / "identity"
PREFLIGHT = SUPABASE_ROOT / "preflight.sql"
PRODUCT_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "0001_product_foundation.sql"
AUTH_HARDENING = ROOT / "docs" / "contracts" / "public-auth-hardening.json"


class PublicIdentityBackendPrepTests(unittest.TestCase):
    def test_identity_contract_selects_dedicated_target_without_enabling_public_auth(self):
        contract = json.loads(IDENTITY_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["status"],
            "provider-adapter-source-v16-deployed-v16-revision-22-legal-policy-projection-ready-registration-disabled-close-disabled",
        )
        self.assertFalse(contract["backend"]["provider_configured"])
        self.assertTrue(contract["backend"]["password_auth_flow_implemented"])
        self.assertTrue(contract["backend"]["compromised_password_screening_implemented"])
        self.assertTrue(contract["backend"]["compromised_password_screening_fail_closed"])
        self.assertTrue(contract["backend"]["session_refresh_implemented"])
        self.assertTrue(contract["backend"]["dedicated_or_isolated_target_required"])
        self.assertFalse(contract["backend"]["conflicting_auth_user_trigger_allowed"])
        self.assertEqual(contract["backend"]["gateway_source_version"], 16)
        self.assertEqual(contract["backend"]["deployed_gateway_source_version"], 16)
        self.assertEqual(contract["backend"]["edge_deployment_revision_observed"], 22)
        self.assertTrue(contract["backend"]["account_close_source_implemented"])
        self.assertEqual(contract["backend"]["account_close_gateway_route"], "/account/close")
        self.assertTrue(contract["backend"]["account_close_gateway_route_deployed"])
        self.assertFalse(contract["backend"]["account_close_enabled"])
        self.assertTrue(contract["backend"]["account_lifecycle_service_deployed"])
        self.assertEqual(contract["backend"]["account_lifecycle_service_deployment_revision_observed"], 2)
        self.assertFalse(contract["backend"]["account_lifecycle_service_enabled"])
        self.assertTrue(contract["backend"]["account_data_export_implemented"])
        self.assertEqual(contract["backend"]["account_data_export_route"], "/account/export")
        self.assertFalse(contract["backend"]["account_data_export_public_enabled"])
        self.assertTrue(contract["backend"]["account_spaces_read_source_implemented"])
        self.assertEqual(contract["backend"]["account_spaces_route"], "/account/spaces")
        self.assertTrue(contract["backend"]["account_spaces_edge_deployed"])
        self.assertFalse(contract["backend"]["account_spaces_mutation_exposed"])
        self.assertTrue(contract["backend"]["account_memory_entitlement_read_source_implemented"])
        self.assertEqual(
            contract["backend"]["account_memory_entitlement_route"],
            "/account/entitlements/memory-cloud",
        )
        self.assertEqual(
            contract["backend"]["account_memory_entitlement_key"],
            "memory.cloud.enabled",
        )
        self.assertTrue(contract["backend"]["account_memory_entitlement_edge_deployed"])
        self.assertEqual(
            contract["backend"]["account_memory_entitlement_edge_deployment_revision_observed"],
            22,
        )
        self.assertTrue(
            contract["backend"]["account_memory_entitlement_requires_authenticated_user"]
        )
        self.assertTrue(contract["backend"]["account_memory_entitlement_subject_from_session"])
        self.assertTrue(contract["backend"]["account_memory_entitlement_uses_user_bearer_rls"])
        self.assertTrue(contract["backend"]["account_memory_entitlement_server_authoritative"])
        self.assertFalse(contract["backend"]["account_memory_entitlement_mutation_exposed"])
        self.assertFalse(contract["backend"]["account_memory_entitlement_service_role_used"])
        self.assertFalse(contract["backend"]["public_cloud_memory_enabled"])
        self.assertTrue(contract["backend"]["public_site_server_activation_gate_deployed"])
        self.assertFalse(contract["backend"]["public_site_account_enabled"])
        self.assertEqual(contract["backend"]["public_site_marker_header"], "X-OrdaX-Public-Site")
        self.assertTrue(contract["backend"]["native_direct_account_gateway_remains_available"])
        self.assertTrue(contract["backend"]["account_registration_server_authoritative_receipt_implemented"])
        self.assertEqual(
            contract["backend"]["account_registration_legal_migration"],
            "20261002221427_account_registration_legal_receipt_v1",
        )
        self.assertEqual(
            contract["backend"]["account_registration_policy_projection_migration"],
            "20261002225800_account_registration_policy_projection_v1",
        )
        self.assertTrue(contract["backend"]["account_registration_policy_projection_applied"])
        self.assertFalse(contract["backend"]["account_registration_policy_active"])
        self.assertTrue(contract["backend"]["account_registration_ui_source_ready"])
        self.assertTrue(contract["backend"]["account_registration_legal_migration_applied"])
        self.assertFalse(contract["backend"]["account_registration_active_legal_policy_present"])
        self.assertFalse(contract["backend"]["account_registration_web_acceptance_bound"])
        self.assertFalse(contract["backend"]["account_registration_native_acceptance_bound"])
        self.assertTrue(contract["backend"]["password_recovery_request_implemented"])
        self.assertFalse(contract["backend"]["password_recovery_request_enabled"])
        self.assertTrue(contract["backend"]["password_recovery_server_side_token_hash_implemented"])
        self.assertFalse(contract["backend"]["password_recovery_redirect_config_verified"])
        self.assertTrue(contract["backend"]["password_recovery_completion_flow_implemented"])
        self.assertFalse(contract["backend"]["password_recovery_completion_enabled"])
        self.assertFalse(contract["backend"]["password_recovery_email_template_applied"])
        candidate = contract["supabase_candidate"]
        self.assertEqual(candidate["project_name"], "ordax-control-plane")
        self.assertTrue(candidate["product_schema_applied"])
        self.assertFalse(candidate["public_auth_enabled"])
        self.assertFalse(candidate["existing_shared_project_mutation_allowed"])

    def test_gateway_boundary_does_not_claim_live_public_provider(self):
        text = SERVICE_README.read_text(encoding="utf-8")
        self.assertIn("PUBLIC SAME-ORIGIN ACTIVATION GATED", text)
        self.assertIn("no public same-origin identity surface is enabled yet", text)
        self.assertIn("GET  /auth/login", text)
        self.assertIn("GET  /auth/register", text)
        self.assertIn("POST /auth/logout", text)
        self.assertIn("HttpOnly", text)
        self.assertNotIn("service_role", text.lower())

    def test_public_auth_hardening_keeps_login_fail_closed(self):
        hardening = json.loads(AUTH_HARDENING.read_text(encoding="utf-8"))
        self.assertEqual(hardening["status"], "public-auth-disabled-hardening-pending")
        self.assertEqual(
            hardening["current_observation"]["leaked_password_protection"],
            "enabled-product-gateway",
        )
        self.assertFalse(hardening["current_observation"]["public_login_enabled"])
        self.assertEqual(hardening["current_observation"]["provider_plan"], "free")
        self.assertFalse(
            hardening["current_observation"]["provider_leaked_password_protection_enabled"]
        )
        self.assertEqual(
            hardening["current_observation"]["provider_leaked_password_protection_advisor"],
            "disabled-warn",
        )
        self.assertTrue(
            hardening["current_observation"]["product_leaked_password_protection_verified"]
        )
        self.assertFalse(
            hardening["current_observation"]["product_leaked_password_plaintext_sent"]
        )
        self.assertFalse(
            hardening["current_observation"]["product_leaked_password_full_hash_sent"]
        )
        self.assertTrue(
            hardening["rules"]["public_login_must_fail_closed_until_all_required_gates_pass"]
        )
        self.assertTrue(
            hardening["required_before_public_login"]["leaked_password_protection_enabled"]
        )
        observation = hardening["current_observation"]
        self.assertEqual(observation["password_policy_product_minimum_chars"], 12)
        self.assertFalse(observation["provider_password_policy_verified"])
        self.assertTrue(observation["rate_limit_provider_defaults_reviewed"])
        self.assertFalse(observation["rate_limit_real_client_ip_forwarding_verified"])
        self.assertEqual(
            observation["password_recovery_request"],
            "pass-source-and-edge-disabled",
        )
        self.assertFalse(observation["password_recovery_redirect_config_verified"])
        self.assertFalse(observation["password_recovery_account_enumeration_allowed"])
        self.assertEqual(
            observation["password_recovery_completion_flow"],
            "pass-source-and-edge-disabled",
        )
        self.assertEqual(
            observation["password_recovery_server_side_token_hash"],
            "pass-source-and-edge-disabled",
        )
        self.assertFalse(observation["password_recovery_completion_enabled"])
        self.assertFalse(observation["password_recovery_email_template_applied"])
        self.assertFalse(observation["account_recovery_flow_tested"])

    def test_supabase_preflight_is_read_only(self):
        sql = PREFLIGHT.read_text(encoding="utf-8").lower()
        statements = [part.strip() for part in sql.split(";") if part.strip()]
        for statement in statements:
            if statement.startswith("--"):
                lines = [
                    line for line in statement.splitlines()
                    if line.strip() and not line.lstrip().startswith("--")
                ]
                statement = "\n".join(lines).strip()
            self.assertTrue(statement.startswith("select"), statement)
        for forbidden in (
            " insert ",
            " update ",
            " delete ",
            " drop ",
            " alter ",
            " create ",
            " grant ",
            " revoke ",
            " truncate ",
        ):
            self.assertNotIn(forbidden, f" {sql} ")

    def test_product_account_migration_is_owner_scoped_and_no_anon_access(self):
        sql = PRODUCT_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create table public.ordax_accounts", sql)
        self.assertIn("references auth.users(id) on delete cascade", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("to authenticated", sql)
        self.assertIn("(select auth.uid()) = user_id", sql)
        self.assertIn("revoke all on table public.ordax_accounts from public, anon, authenticated", sql)
        self.assertIn("grant select, update on table public.ordax_accounts to authenticated", sql)
        self.assertNotRegex(sql, re.compile(r"grant\s+.*\s+to\s+anon"))

    def test_account_bootstrap_function_is_private_and_search_path_locked(self):
        sql = PRODUCT_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create schema if not exists private", sql)
        self.assertIn("private.handle_ordax_account_created()", sql)
        self.assertIn("security definer", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("on_auth_user_created_ordax_product", sql)
        self.assertIn("after insert on auth.users", sql)


if __name__ == "__main__":
    unittest.main()
