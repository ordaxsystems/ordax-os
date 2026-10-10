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
            "canonical-identity-source-auth-only-full-account-pending",
        )
        self.assertFalse(contract["backend"]["provider_configured"])
        self.assertTrue(contract["backend"]["password_auth_flow_implemented"])
        self.assertTrue(contract["backend"]["compromised_password_screening_implemented"])
        self.assertTrue(contract["backend"]["compromised_password_screening_fail_closed"])
        self.assertTrue(contract["backend"]["session_refresh_implemented"])
        self.assertTrue(contract["backend"]["dedicated_or_isolated_target_required"])
        self.assertFalse(contract["backend"]["conflicting_auth_user_trigger_allowed"])
        self.assertEqual(contract["backend"]["gateway_source_version"], 17)
        self.assertEqual(contract["backend"]["deployed_gateway_source_version"], 17)
        self.assertTrue(contract["backend"]["native_direct_auth_rate_limit_source_ready"])
        self.assertTrue(contract["backend"]["native_direct_auth_rate_limit_deployed"])
        self.assertEqual(
            contract["backend"]["native_direct_auth_rate_limit_rpc"],
            "ordax_consume_public_auth_rate_limit_v1",
        )
        self.assertEqual(
            contract["backend"]["native_direct_auth_rate_limit_client_address_source"],
            "supabase-edge-cf-connecting-ip",
        )
        self.assertTrue(contract["backend"]["native_direct_auth_rate_limit_fail_closed"])
        self.assertEqual(
            contract["backend"]["native_direct_auth_rate_limit_deployment_revision_observed"],
            28,
        )
        self.assertEqual(
            contract["backend"]["native_direct_auth_rate_limit_shared_policy_source"],
            "infra/supabase/functions/_shared/auth_rate_limit.mjs",
        )
        self.assertFalse(contract["backend"]["native_direct_auth_rate_limit_raw_ip_persisted"])
        self.assertEqual(contract["backend"]["edge_deployment_revision_observed"], 28)
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
            28,
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
        # Only the canonical migration/destination plan owns the provider.
        # Old project refs must not survive in a second identity contract.
        self.assertNotIn("supabase_candidate", contract)
        destination_path = ROOT / contract["backend"]["canonical_supabase_destination_contract"]
        destination = json.loads(destination_path.read_text(encoding="utf-8"))
        self.assertEqual(destination["destination_project_name"], "ordax-platform")
        self.assertEqual(destination["destination_project_ref"], "jhfphsjptrpmtnzkpwud")
        self.assertNotIn("ordax-control-plane", json.dumps(contract))
        self.assertNotIn("eobcxuyvhkvdmkbaihwh", json.dumps(contract))
        self.assertFalse(destination["parallel_identity_write_allowed"])

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
        self.assertEqual(hardening["status"], "public-auth-disabled-bridge-unprovisioned-legal-pending")
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
        self.assertTrue(observation["email_confirmation_provider_verified"])
        self.assertEqual(
            observation["email_confirmation_provider_evidence"],
            "supabase-auth-v1-settings-mailer-autoconfirm-false",
        )
        self.assertTrue(observation["rate_limit_provider_defaults_reviewed"])
        self.assertFalse(observation["rate_limit_real_client_ip_forwarding_verified"])
        self.assertEqual(
            observation["password_recovery_request"],
            "pass-source-and-edge-v28-disabled-isolated-session",
        )
        self.assertFalse(observation["password_recovery_redirect_config_verified"])
        self.assertFalse(observation["password_recovery_account_enumeration_allowed"])
        self.assertEqual(
            observation["password_recovery_completion_flow"],
            "pass-source-and-edge-v28-disabled-isolated-session",
        )
        self.assertEqual(
            observation["password_recovery_server_side_token_hash"],
            "pass-source-and-edge-v28-disabled",
        )
        self.assertFalse(observation["password_recovery_completion_enabled"])
        self.assertFalse(observation["password_recovery_email_template_applied"])
        self.assertFalse(observation["account_recovery_flow_tested"])
        self.assertEqual(observation["observed_date"], "2026-10-09")
        self.assertEqual(observation["public_edge_gateway_version"], 3)
        self.assertIn("v28-deployed", observation["edge_gateway"])
        self.assertIn("canonical-supabase-v3", observation["public_edge_gateway"])
        self.assertTrue(observation["public_edge_product_cookie_envelope_deployed"])
        self.assertEqual(
            observation["public_edge_product_cookie_envelope_header"],
            "x-ordax-cookie-envelope",
        )
        self.assertTrue(observation["vercel_product_cookie_envelope_source_merged"])
        self.assertFalse(observation["vercel_product_cookie_envelope_deployed"])
        self.assertTrue(observation["password_recovery_session_isolated"])
        self.assertEqual(observation["password_recovery_cookie_path"], "/auth/recover")
        self.assertFalse(observation["bot_protection_widget_live_verified"])
        self.assertEqual(
            observation["bot_protection_widget_domains"],
            ["ordax.com.br", "www.ordax.com.br"],
        )
        self.assertTrue(observation["bot_protection_production_secret_configured"])
        self.assertFalse(observation["public_adapter_rate_limit_deployed"])
        self.assertTrue(
            hardening["required_before_public_login"][
                "registration_provider_bypass_guard_verified"
            ]
        )
        self.assertTrue(observation["provider_signup_api_enabled"])
        self.assertTrue(observation["registration_provider_bypass_guard_verified"])
        self.assertEqual(
            observation["registration_provider_bypass_guard_trigger"],
            "on_auth_user_created_ordax_product",
        )
        self.assertEqual(
            observation["registration_provider_bypass_guard_function"],
            "private.handle_ordax_account_created",
        )
        self.assertTrue(
            observation["registration_provider_bypass_guard_search_path_empty"]
        )
        self.assertTrue(
            observation["registration_provider_bypass_guard_requires_active_policy"]
        )
        self.assertTrue(
            observation["registration_provider_bypass_guard_requires_email_hash_match"]
        )
        self.assertTrue(
            observation[
                "registration_provider_bypass_guard_requires_unconsumed_unexpired_intent"
            ]
        )
        self.assertTrue(
            observation["registration_provider_bypass_guard_writes_legal_receipt"]
        )
        self.assertEqual(observation["legacy_accounts_without_legal_receipt_count"], 2)
        self.assertTrue(
            observation["legacy_account_legal_receipt_reconciliation_verified"]
        )
        self.assertEqual(observation["legacy_account_legal_quarantine_active_count"], 2)
        self.assertEqual(observation["legacy_account_legal_quarantine_unreconciled_count"], 0)
        self.assertTrue(observation["legacy_account_legal_quarantine_deployed"])
        self.assertEqual(
            observation["legacy_account_legal_quarantine_status_rpc"],
            "ordax_account_legal_reconciliation_status_v1",
        )
        self.assertFalse(observation["legacy_accounts_public_login_allowed"])
        self.assertTrue(observation["public_login_legal_receipt_guard_source_ready"])
        self.assertTrue(observation["public_login_legal_receipt_guard_deployed"])
        self.assertEqual(
            observation["public_login_legal_receipt_guard_rpc"],
            "ordax_account_has_registration_legal_receipt_v1",
        )
        self.assertEqual(
            observation["public_login_legal_receipt_guard_deployment_revision_observed"],
            28,
        )
        self.assertTrue(
            observation["public_login_legal_receipt_guard_live_nonexistent_subject_denied"]
        )
        self.assertTrue(observation["public_login_legal_receipt_guard_public_only"])
        self.assertEqual(
            observation["public_login_legal_receipt_guard_rejected_session_scope"],
            "local",
        )

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
