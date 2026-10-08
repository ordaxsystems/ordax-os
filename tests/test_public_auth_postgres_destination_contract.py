"""Fail-closed checks for account provider cutover; no parallel identity authority."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "public-auth-hardening.json"
SOURCE = ROOT / "infra" / "supabase" / "product" / "migrations"


class AccountPostgresCutoverContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.destination = cls.contract["postgresql_destination"]

    def test_only_existing_provider_is_current_until_promotion(self):
        stage = self.destination
        self.assertFalse(stage["parallel_identity_write_enabled"])
        self.assertTrue(stage["project_ref"])
        self.assertTrue(stage["source_owner"].endswith("/migrations"))
        if not stage["functional_provider_cutover_complete"]:
            self.assertNotEqual(self.contract["target"]["project_ref"], stage["project_ref"])
            self.assertFalse(stage["public_registration_enabled"])
            self.assertFalse(stage["public_login_enabled"])
            self.assertFalse(stage["public_account_gateway_deployed"])
            self.assertFalse(stage["active_legal_policy_present"])

    def test_promotion_requires_proven_runtime_not_just_migrations(self):
        stage = self.destination
        if stage["functional_provider_cutover_complete"]:
            for name in (
                "public_account_gateway_deployed",
                "provider_settings_e2e_verified",
                "session_revocation_e2e_verified",
                "recovery_e2e_verified",
            ):
                self.assertTrue(stage[name], f"cutover requires {name}")
        else:
            self.assertFalse(stage["public_login_enabled"])
            self.assertFalse(stage["public_registration_enabled"])

    def test_destination_runtime_remains_closed_despite_sql_readiness(self):
        stage = self.destination
        self.assertTrue(stage["database_rate_limit_full_sql_proof_passed"])
        self.assertTrue(stage["database_rate_limit_test_rows_rolled_back"])
        self.assertTrue(stage["legacy_legal_quarantine_applied"])
        self.assertFalse(stage["public_auth_rate_limit_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["parallel_identity_write_enabled"])

    def test_live_sync_export_sql_proof_cannot_be_confused_with_public_runtime(self):
        stage = self.destination
        self.assertTrue(stage["sync_export_db_boundary_proven"])
        self.assertTrue(stage["sync_request_subject_bridge_deployed"])
        self.assertTrue(stage["sync_export_postgres_two_subject_sql_proof_passed"])
        self.assertTrue(stage["sync_export_postgres_sql_proof_rolled_back"])
        self.assertTrue(stage["sync_export_executors_no_login_no_bypassrls_verified"])
        self.assertFalse(stage["sync_executor_direct_auth_schema_usage"])
        self.assertEqual(stage["sync_export_database_user_count_after_proof"], 0)
        self.assertEqual(
            stage["sync_export_atomic_migration_name"],
            "account_sync_export_destination_atomic_v1",
        )
        self.assertEqual(
            stage["sync_request_subject_bridge_migration_name"],
            "sync_request_subject_bridge_v1",
        )
        self.assertFalse(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["account_export_runtime_e2e_verified"])
        self.assertFalse(stage["sync_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["functional_provider_cutover_complete"])

        source = ROOT / stage["sync_export_postgres_two_subject_sql_proof_source"]
        proof = source.read_text(encoding="utf-8").lower()
        self.assertIn("public.ordax_account_export_v1()", proof)
        self.assertIn("public.ordax_apply_sync_mutation_v2(", proof)
        self.assertIn("cross-user-sync-export-leak", proof)
        self.assertTrue(proof.rstrip().endswith("rollback;"))
        migration = SOURCE / "20261008092000_sync_request_subject_bridge_v1.sql"
        self.assertTrue(migration.is_file())
        self.assertIn(
            "grant execute on function public.ordax_request_subject_v1() to ordax_sync_executor",
            migration.read_text(encoding="utf-8").lower(),
        )

    def test_staging_gateway_and_vercel_destination_evidence_are_distinct(self):
        stage = self.destination
        self.assertEqual(stage["project_ref"], "jhfphsjptrpmtnzkpwud")
        self.assertTrue(stage["internal_gateway_staging_deployed"])
        self.assertGreaterEqual(stage["internal_gateway_staging_version"], 2)
        self.assertTrue(stage["internal_gateway_staging_verify_jwt"])
        self.assertEqual(len(stage["internal_gateway_staging_artifact_sha256"]), 64)
        self.assertFalse(stage["internal_gateway_runtime_e2e_verified"])
        self.assertFalse(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["destination_vercel_public_project_found"])
        self.assertEqual(stage["destination_vercel_team_slug"], "ordaxsystems")
        self.assertEqual(stage["destination_vercel_public_project_name"], "ordax-os-public")
        self.assertFalse(stage["destination_vercel_oidc_binding_verified"])
        self.assertFalse(stage["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        source = ROOT / stage["internal_gateway_staging_source"]
        gateway = source.read_text(encoding="utf-8")
        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", gateway)

    def test_new_api_key_cannot_impersonate_supabase_jwt(self):
        stage = self.destination
        self.assertTrue(stage["internal_gateway_staging_verify_jwt"])
        self.assertFalse(stage["destination_service_transport_runtime_verified"])
        self.assertFalse(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_login_enabled"])
        outer = (ROOT / stage["destination_gateway_transport_source_reference"]).read_text(encoding="utf-8")
        inner = (ROOT / stage["destination_gateway_auth_source_reference"]).read_text(encoding="utf-8")
        self.assertIn('headers.set("apikey", serverSecret)', outer)
        self.assertNotIn('headers.set("authorization",', outer)
        self.assertIn('function trustedPublicSiteRequest(req: Request)', inner)
        self.assertIn("return authenticatedAccountBridge(", inner)
        self.assertNotIn("expectedKey = adminConfig().key", inner)
        self.assertIn("headers: upstreamHeaders(req, publicBridgeKey())", outer)
        self.assertTrue(stage["destination_gateway_platform_auth_reference"].startswith("https://supabase.com/"))

    def test_named_service_bridge_is_not_production_credential_evidence(self):
        stage = self.destination
        self.assertTrue(stage["destination_named_bridge_source_prepared"])
        self.assertEqual(
            stage["destination_named_bridge_key_name"],
            "ordax-account-public-bridge",
        )
        self.assertFalse(stage["destination_named_bridge_key_provisioned"])
        self.assertFalse(stage["destination_named_bridge_runtime_e2e_verified"])
        self.assertFalse(stage["destination_service_transport_runtime_verified"])
        self.assertFalse(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        helper = (
            ROOT / "infra" / "supabase" / "functions" / "_shared"
            / "account_service_bridge.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn('ACCOUNT_BRIDGE_KEY_NAME = "ordax-account-public-bridge"', helper)
        self.assertIn("authenticatedAccountBridge(", helper)

    def test_new_oidc_source_is_scoped_without_runtime_activation(self):
        stage = self.destination
        self.assertTrue(stage["destination_vercel_oidc_source_updated"])
        self.assertEqual(stage["destination_vercel_oidc_source_expected_team"], "ordaxsystems")
        self.assertEqual(stage["destination_vercel_oidc_source_expected_project"], "ordax-os-public")
        self.assertFalse(stage["destination_vercel_public_project_found"])
        self.assertFalse(stage["destination_vercel_oidc_binding_verified"])
        self.assertFalse(stage["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertFalse(stage["public_account_gateway_deployed"])
        source = (
            ROOT / "infra" / "supabase" / "functions"
            / "ordax-public-account-gateway" / "vercel_oidc.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("https://oidc.vercel.com/ordaxsystems", source)
        self.assertIn(
            "owner:ordaxsystems:project:ordax-os-public:environment:production", source
        )
        self.assertNotIn('jogo-brasils-projects', source)

    def test_migration_sources_are_single_owned_and_versioned(self):
        names = self.destination["canonical_migrations_applied"]
        self.assertEqual(len(names), len(set(names)), "duplicate SQL source")
        self.assertGreaterEqual(len(names), 8)
        sources = {}
        for name in names:
            self.assertEqual(Path(name).name, name)
            self.assertTrue(name.endswith(".sql"))
            path = SOURCE / name
            self.assertTrue(path.is_file(), f"missing canonical migration: {name}")
            sql = path.read_text(encoding="utf-8").lower()
            statements = [
                line.strip() for line in sql.splitlines()
                if line.strip() and not line.lstrip().startswith("--")
            ]
            self.assertEqual(statements[0], "begin;")
            self.assertEqual(statements[-1], "commit;")
            sources[name] = sql

        registration = next(
            body for name, body in sources.items()
            if "account_registration_legal_receipt_v1.sql" in name
        )
        self.assertIn("ordax-registration-legal-intent-required", registration)
        self.assertIn("private.ordax_account_legal_receipts", registration)
        self.assertIn("enable row level security", registration)
        self.assertIn("to service_role", registration)

        validation_v2 = next(
            body for name, body in sources.items()
            if "account_registration_intent_email_validation_v2.sql" in name
        )
        validation_body = validation_v2.split("create or replace function", 1)[1]
        self.assertNotIn("chr(0)", validation_body)
        self.assertIn("char_length(v_email) > 320 then", validation_body)
        self.assertIn("registration-legal-policy-unavailable", validation_body)
        self.assertIn("to service_role", validation_body)

        rate_limit = next(
            body for name, body in sources.items()
            if "public_auth_rate_limit_v1.sql" in name
        )
        self.assertIn("private.ordax_public_auth_rate_limits", rate_limit)
        self.assertIn("ordax_consume_public_auth_rate_limit_v1", rate_limit)
        self.assertIn("to service_role", rate_limit)
        self.assertIn("enable row level security", rate_limit)

        quarantine = next(
            body for name, body in sources.items()
            if "account_legacy_legal_quarantine_v1.sql" in name
        )
        self.assertIn("ordax_account_legal_quarantine", quarantine)
        self.assertIn("ordax_account_legal_receipts", quarantine)
        self.assertIn("to service_role", quarantine)

        login_guard = next(
            body for name, body in sources.items()
            if "public_login_legal_receipt_guard_v1.sql" in name
        )
        self.assertIn("ordax_account_has_registration_legal_receipt_v1", login_guard)
        self.assertIn("from public, anon, authenticated, service_role", login_guard)
        self.assertIn("to service_role", login_guard)


if __name__ == "__main__":
    unittest.main()
