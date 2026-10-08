import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-lifecycle" / "index.ts"
EXPORT_EXECUTOR_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007070000_account_export_executor_v1.sql"
)
EXPORT_SUBJECT_BRIDGE_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007071500_account_export_subject_bridge_v1.sql"
)
DESTINATION_EXPORT_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261008085000_account_data_export_project_id_v1.sql"
)
HISTORICAL_EXPORT_MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20260925031000_account_data_export_v1.sql"
)
ACCOUNT_LIFECYCLE_CONTRACT = ROOT / "docs" / "contracts" / "account-lifecycle.json"
SECURITY_POSTURE_CONTRACT = ROOT / "docs" / "contracts" / "supabase-security-posture.json"
ACCOUNT_PROVIDER_SOURCE = ROOT / "services" / "public-identity" / "supabase_account.py"


class AccountLifecycleEdgeTests(unittest.TestCase):
    def setUp(self):
        self.text = SOURCE.read_text(encoding="utf-8")

    def test_account_close_is_disabled_by_default_and_requires_recent_auth(self):
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", self.text)
        self.assertIn('const CLOSE_CONFIRMATION = "close-account";', self.text)
        self.assertIn("MAX_FRESH_TOKEN_AGE_SECONDS = 5 * 60", self.text)
        self.assertIn("recent-authentication-required", self.text)
        self.assertIn("auth.getUser(token)", self.text)

    def test_service_role_is_isolated_to_dedicated_lifecycle_service(self):
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", self.text)
        self.assertIn('auth.admin.signOut(token, "global")', self.text)
        self.assertIn("auth.admin.deleteUser(userId)", self.text)
        public_gateway = (
            ROOT
            / "infra"
            / "supabase"
            / "functions"
            / "ordax-account-gateway"
            / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("SUPABASE_SECRET_KEYS", public_gateway)
        self.assertEqual(public_gateway.count("SUPABASE_SERVICE_ROLE_KEY"), 1)
        self.assertIn("function adminConfig()", public_gateway)
        self.assertIn("ordax_begin_account_registration_legal_intent_v1", public_gateway)
        self.assertNotIn("auth.admin.signOut", public_gateway)
        self.assertNotIn("auth.admin.deleteUser", public_gateway)

    def test_close_requires_explicit_confirmation_before_admin_delete(self):
        confirmation = self.text.index("payload.confirmation !== CLOSE_CONFIRMATION")
        revoke = self.text.index('auth.admin.signOut(token, "global")')
        delete = self.text.index("auth.admin.deleteUser(userId)")
        self.assertLess(confirmation, revoke)
        self.assertLess(revoke, delete)

    def test_close_fails_closed_if_global_session_revocation_fails(self):
        revoke = self.text.index('auth.admin.signOut(token, "global")')
        failure = self.text.index("account-close-session-revocation-failed")
        delete = self.text.index("auth.admin.deleteUser(userId)")
        self.assertLess(revoke, failure)
        self.assertLess(failure, delete)

    def test_public_gateway_close_source_is_disabled_and_has_no_admin_key(self):
        public_gateway = (
            ROOT
            / "infra"
            / "supabase"
            / "functions"
            / "ordax-account-gateway"
            / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", public_gateway)
        self.assertIn('path === "/account/close" && req.method === "POST"', public_gateway)
        self.assertIn("/functions/v1/ordax-account-lifecycle/close", public_gateway)
        self.assertIn("signInWithPassword", public_gateway)
        close_start = public_gateway.index("async function closeAccount")
        close_end = public_gateway.index("async function credentials", close_start)
        close_source = public_gateway[close_start:close_end]
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", close_source)
        self.assertNotIn("SUPABASE_SECRET_KEYS", close_source)
        self.assertNotIn("adminClient()", close_source)
        self.assertNotIn("auth.admin.deleteUser", public_gateway)

    def test_health_reports_disabled_state(self):
        self.assertIn('service: "ordax-account-lifecycle"', self.text)
        self.assertIn("accountCloseEnabled: ACCOUNT_CLOSE_ENABLED", self.text)

    def test_destination_export_initial_migration_uses_canonical_memory_project_id(self):
        init = DESTINATION_EXPORT_MIGRATION.read_text(encoding="utf-8").lower()
        bridge = EXPORT_SUBJECT_BRIDGE_MIGRATION.read_text(encoding="utf-8").lower()
        historical = HISTORICAL_EXPORT_MIGRATION.read_text(encoding="utf-8").lower()
        for sql in (init, bridge):
            self.assertIn("'project_id', m.project_id", sql)
            self.assertNotIn("'project_ref', m.project_ref", sql)
            self.assertIn("where m.owner_user_id = (select user_id from me)", sql)
            self.assertIn("'$schema', 'prototype-ordax.account-export/1'", sql)
        self.assertIn("'project_ref', m.project_ref", historical)
        self.assertIn("security invoker", init)
        self.assertIn("set search_path = ''", init)
        self.assertIn("grant execute on function public.ordax_account_export_v1()", init)
        self.assertIn("revoke all on function public.ordax_account_export_v1()", init)
        self.assertIn("ordax_account_export_executor", bridge)
        # Old provider history must never be rewritten to fake its schema.
        self.assertNotIn("'project_id', m.project_id", historical)

    def test_destination_cutover_bundle_is_one_transaction_with_one_source_of_truth(self):
        generator = ROOT / "infra" / "supabase" / "product" / "render_account_destination_migration.py"
        spec = importlib.util.spec_from_file_location("ordax_account_cutover_bundle", generator)
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        bundle = module.render(project_ref="jhfphsjptrpmtnzkpwud")
        plan = json.loads(
            (ROOT / "infra" / "supabase" / "product"
             / "account_destination_migration_plan.json").read_text(encoding="utf-8")
        )
        self.assertEqual(bundle.splitlines().count("BEGIN;"), 1)
        self.assertTrue(bundle.rstrip().endswith("COMMIT;"))
        self.assertIn("account-cutover-destination-not-empty", bundle)
        self.assertIn("account-cutover-users-present", bundle)
        self.assertIn("account-cutover-privileged-executor", bundle)
        self.assertIn("account-cutover-memory-project-identity-drift", bundle)
        self.assertIn("account-cutover-subject-bridge-exposed", bundle)
        self.assertNotIn("SOURCE 20260925031000_account_data_export_v1.sql", bundle)
        self.assertIn("SOURCE 20261008085000_account_data_export_project_id_v1.sql", bundle)
        self.assertEqual(len(plan["ordered_source_files"]), 9)
        self.assertEqual(bundle.count("-- SOURCE "), 9)
        with self.assertRaisesRegex(ValueError, "destination-cutover-plan-untrusted"):
            module.render(project_ref="eobcxuyvhkvdmkbaihwh")

    def test_account_export_rpc_uses_dedicated_non_bypass_executor(self):
        migration = EXPORT_EXECUTOR_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create role ordax_account_export_executor", migration)
        self.assertIn("noinherit nologin noreplication nobypassrls", migration)
        self.assertIn(
            "alter function public.ordax_account_export_v1() owner to ordax_account_export_executor",
            migration,
        )
        self.assertIn("grant select on table", migration)
        self.assertNotIn("grant insert on table", migration)
        self.assertNotIn("grant update on table", migration)
        self.assertNotIn("grant delete on table", migration)
        self.assertIn(
            "grant execute on function public.ordax_account_export_v1() to authenticated",
            migration,
        )

    def test_account_export_subject_bridge_is_minimal_and_executor_stays_out_of_auth_schema(self):
        migration = EXPORT_SUBJECT_BRIDGE_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("function public.ordax_request_subject_v1()", migration)
        self.assertIn("select auth.uid();", migration)
        self.assertIn("security definer", migration)
        self.assertIn("set search_path = ''", migration)
        self.assertIn(
            "grant execute on function public.ordax_request_subject_v1()\n  to ordax_account_export_executor",
            migration,
        )
        self.assertIn("revoke all on schema auth from ordax_account_export_executor", migration)
        self.assertIn("select public.ordax_request_subject_v1() as user_id", migration)
        self.assertIn("ordax_sync_objects_export_own", migration)
        self.assertNotIn("grant insert on table", migration)
        self.assertNotIn("grant update on table", migration)
        self.assertNotIn("grant delete on table", migration)

    def test_account_export_contracts_describe_effective_security_boundary(self):
        lifecycle = json.loads(ACCOUNT_LIFECYCLE_CONTRACT.read_text(encoding="utf-8"))
        export = lifecycle["operations"]["account_data_export"]
        self.assertEqual(export["executor_role"], "ordax_account_export_executor")
        self.assertTrue(export["rpc_security_definer"])
        self.assertFalse(export["executor_login_allowed"])
        self.assertFalse(export["executor_inherit_allowed"])
        self.assertFalse(export["executor_bypass_rls_allowed"])
        self.assertFalse(export["executor_direct_write_privileges_allowed"])
        self.assertEqual(export["executor_policy_scope"], "own-subject-only")
        self.assertEqual(export["request_subject_bridge"], "ordax_request_subject_v1")
        self.assertFalse(export["request_subject_bridge_reads_relations"])
        self.assertFalse(export["provider_auth_schema_usage_granted_to_executor"])

        posture = json.loads(SECURITY_POSTURE_CONTRACT.read_text(encoding="utf-8"))
        reviewed = posture["reviewed_security_definer_boundaries"]["account_export"]
        self.assertEqual(reviewed["executor_role"], "ordax_account_export_executor")
        self.assertFalse(reviewed["executor_bypass_rls_allowed"])
        self.assertFalse(reviewed["executor_auth_schema_usage"])
        self.assertFalse(reviewed["request_subject_bridge_relation_reads"])
        self.assertFalse(reviewed["request_subject_bridge_api_role_execute_allowed"])
        self.assertFalse(reviewed["cross_subject_reads_allowed"])
        self.assertTrue(reviewed["synthetic_unknown_subject_export_empty_verified"])

    def test_account_provider_documents_effective_export_boundary(self):
        provider = ACCOUNT_PROVIDER_SOURCE.read_text(encoding="utf-8")
        self.assertIn("SECURITY DEFINER", provider)
        self.assertIn("private sync relation", provider)
        self.assertIn("scopes every exported domain to ``auth.uid()``", provider)
        self.assertNotIn("RLS-scoped RPC that is SECURITY INVOKER", provider)


if __name__ == "__main__":
    unittest.main()
