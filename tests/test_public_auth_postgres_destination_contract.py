"""Fail-closed checks for Account runtime transport and public activation boundaries."""

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

    def test_transport_proof_does_not_authorize_public_account_activation(self):
        stage = self.destination
        self.assertFalse(stage["parallel_identity_write_enabled"])
        self.assertEqual(stage["project_ref"], "jhfphsjptrpmtnzkpwud")
        self.assertTrue(stage["source_owner"].endswith("/migrations"))
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertTrue(stage["internal_gateway_runtime_e2e_verified"])
        self.assertTrue(stage["destination_service_transport_runtime_verified"])
        self.assertFalse(stage["functional_provider_cutover_complete"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertTrue(stage["active_legal_policy_present"])
        self.assertTrue(stage["existing_auth_users_observed"])
        proof = json.loads((ROOT / stage["active_legal_policy_observation_evidence"]).read_text(encoding="utf-8"))
        self.assertTrue(proof["observation"]["active_policy_has_activation_timestamp"])
        self.assertFalse(proof["separate_release_gates"]["approved_immutable_legal_snapshots"])
        self.assertFalse(proof["separate_release_gates"]["operator_identity_reviewed"])
        self.assertFalse(proof["separate_release_gates"]["provider_cutover_complete"])
        self.assertFalse(proof["separate_release_gates"]["account_activation_authorized"])

    def test_promotion_still_requires_unproven_account_lifecycle_gates(self):
        stage = self.destination
        self.assertFalse(stage["provider_settings_e2e_verified"])
        self.assertFalse(stage["session_revocation_e2e_verified"])
        self.assertFalse(stage["recovery_e2e_verified"])
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

    def test_destination_runtime_is_live_but_public_activation_remains_closed(self):
        stage = self.destination
        self.assertTrue(stage["database_rate_limit_full_sql_proof_passed"])
        self.assertTrue(stage["database_rate_limit_test_rows_rolled_back"])
        self.assertTrue(stage["legacy_legal_quarantine_applied"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertTrue(stage["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertTrue(stage["destination_named_bridge_runtime_e2e_verified"])
        self.assertFalse(stage["public_auth_rate_limit_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["parallel_identity_write_enabled"])

    def test_live_sync_export_sql_proof_cannot_be_confused_with_public_activation(self):
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
        self.assertTrue(stage["public_account_gateway_deployed"])
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

    def test_live_gateway_and_vercel_runtime_evidence_are_current(self):
        stage = self.destination
        self.assertTrue(stage["internal_gateway_staging_deployed"])
        self.assertEqual(stage["internal_gateway_staging_version"], 13)
        self.assertFalse(stage["internal_gateway_staging_verify_jwt"])
        self.assertTrue(stage["internal_gateway_runtime_e2e_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertTrue(stage["destination_vercel_public_project_found"])
        self.assertEqual(
            stage["destination_vercel_public_project_evidence_source"],
            "docs/contracts/public-site-deployment.json",
        )
        self.assertTrue(stage["destination_vercel_oidc_binding_verified"])
        self.assertEqual(stage["destination_vercel_team_slug"], "ordaxsystems")
        self.assertEqual(stage["destination_vercel_public_project_name"], "ordax-os-public")
        self.assertTrue(stage["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertEqual(stage["internal_gateway_staging_artifact_sha256_observation_version"], 6)
        self.assertEqual(len(stage["internal_gateway_staging_artifact_sha256"]), 64)
        evidence = ROOT / stage["runtime_evidence"]
        self.assertTrue(evidence.is_file())
        source = ROOT / stage["internal_gateway_staging_source"]
        gateway = source.read_text(encoding="utf-8")
        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", gateway)
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", gateway)

    def test_named_bridge_requires_custom_handler_auth_not_platform_jwt(self):
        stage = self.destination
        self.assertFalse(stage["internal_gateway_staging_verify_jwt"])
        self.assertTrue(stage["destination_service_transport_runtime_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_login_enabled"])
        outer = (ROOT / stage["destination_gateway_transport_source_reference"]).read_text(encoding="utf-8")
        inner = (ROOT / stage["destination_gateway_auth_source_reference"]).read_text(encoding="utf-8")
        self.assertIn('headers.set("apikey", serverSecret)', outer)
        self.assertNotIn('headers.set("authorization",', outer)
        self.assertIn("const transport = await authorizeAccountTransport(req, path, {", inner)
        self.assertIn("verifyNativeSession: async () => {", inner)
        self.assertIn("return Boolean(session.user && session.access)", inner)
        self.assertNotIn("expectedKey = adminConfig().key", inner)
        self.assertIn("headers: upstreamHeaders(req, bridgeKey)", outer)
        self.assertTrue(stage["destination_gateway_platform_auth_reference"].startswith("https://supabase.com/"))

    def test_named_service_bridge_is_proven_without_recording_secret_value(self):
        stage = self.destination
        self.assertTrue(stage["destination_named_bridge_source_prepared"])
        self.assertEqual(stage["destination_named_bridge_key_name"], "ordax_account_public_bridge")
        self.assertTrue(stage["destination_named_bridge_key_provisioned"])
        self.assertTrue(stage["destination_named_bridge_runtime_e2e_verified"])
        self.assertTrue(stage["destination_service_transport_runtime_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertNotIn("secret_value", stage)
        helper = (
            ROOT / "infra" / "supabase" / "functions" / "_shared"
            / "account_service_bridge.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn('ACCOUNT_BRIDGE_KEY_NAME = "ordax_account_public_bridge"', helper)
        self.assertIn("authenticatedAccountBridge(", helper)

    def test_oidc_source_and_production_runtime_are_both_scoped(self):
        stage = self.destination
        self.assertTrue(stage["destination_vercel_oidc_source_updated"])
        self.assertEqual(stage["destination_vercel_oidc_source_expected_team"], "ordaxsystems")
        self.assertEqual(stage["destination_vercel_oidc_source_expected_project"], "ordax-os-public")
        self.assertTrue(stage["destination_vercel_public_project_found"])
        self.assertTrue(stage["destination_vercel_oidc_binding_verified"])
        self.assertTrue(stage["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        source = (
            ROOT / "infra" / "supabase" / "functions"
            / "ordax-public-account-gateway" / "vercel_oidc.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("https://oidc.vercel.com/ordaxsystems", source)
        self.assertIn(
            "owner:ordaxsystems:project:ordax-os-public:environment:production", source
        )
        self.assertNotIn('jogo-brasils-projects', source)

    def test_gateway_v13_transport_is_live_without_promoting_account_activation(self):
        stage = self.destination
        self.assertTrue(stage["destination_transport_admission_source_prepared"])
        self.assertTrue(stage["destination_transport_admission_deployed"])
        self.assertFalse(stage["internal_gateway_staging_verify_jwt"])
        self.assertEqual(stage["internal_gateway_staging_version"], 13)
        self.assertTrue(stage["internal_gateway_runtime_e2e_verified"])
        self.assertTrue(stage["destination_named_bridge_key_provisioned"])
        self.assertTrue(stage["destination_named_bridge_runtime_e2e_verified"])
        self.assertTrue(stage["destination_service_transport_runtime_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["functional_provider_cutover_complete"])
        gateway = (
            ROOT / "infra" / "supabase" / "functions"
            / "ordax-account-gateway" / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("authorizeAccountTransport(req, path", gateway)
        self.assertIn("supabase.auth.getUser(access)", gateway)

    def test_shared_route_and_sync_hardening_remain_deployed(self):
        stage = self.destination
        self.assertTrue(stage["internal_gateway_route_prefix_hardening_deployed"])
        self.assertTrue(stage["internal_gateway_sync_mutation_object_guard_deployed"])
        self.assertEqual(stage["internal_gateway_staging_version"], 13)
        self.assertFalse(stage["internal_gateway_staging_verify_jwt"])
        self.assertTrue(stage["destination_named_bridge_key_provisioned"])
        self.assertTrue(stage["destination_service_transport_runtime_verified"])
        self.assertTrue(stage["public_account_gateway_deployed"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["public_login_enabled"])
        owner = (
            ROOT / "infra" / "supabase" / "functions" / "_shared"
            / "account_transport_admission.mjs"
        ).read_text(encoding="utf-8")
        gateway = (
            ROOT / "infra" / "supabase" / "functions"
            / "ordax-account-gateway" / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertIn('pathname.startsWith(prefix + "/")', owner)
        self.assertIn("export function stripEdgeFunctionPrefix(", owner)
        self.assertIn('return stripEdgeFunctionPrefix(pathname, "ordax-account-gateway")', owner)
        self.assertIn('accountGatewayRoutePath(url.pathname)', gateway)
        self.assertIn('if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))', gateway)

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
