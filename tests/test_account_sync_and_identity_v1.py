import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNC_CONTRACT = ROOT / "docs" / "contracts" / "sync-model.json"
SYNC_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925004439_account_sync_objects_v1.sql"
GATEWAY = ROOT / "services" / "public-identity" / "gateway.py"
EDGE_GATEWAY = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
NATIVE_GATEWAY_CONFIG = ROOT / "system" / "services" / "account" / "gateway-base-url"
CURSOR_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013355_account_sync_incremental_cursor_v1.sql"
SNAPSHOT_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013524_account_sync_atomic_snapshot_v1.sql"
TWO_CLIENT_PROOF = ROOT / "tools" / "account-sync" / "prove_two_clients.py"
TWO_CLIENT_WORKFLOW = ROOT / ".github" / "workflows" / "account-sync-two-client-proof.yml"
SESSION_REVOCATION_PROOF = ROOT / "tools" / "account-sync" / "prove_session_revocation.py"
SESSION_REVOCATION_WORKFLOW = ROOT / ".github" / "workflows" / "account-session-revocation-proof.yml"
ACCOUNT_CLOSE_DISABLED_PROOF = ROOT / "tools" / "account-sync" / "prove_account_close_disabled.py"
RECOVERY_EMAIL_TEMPLATE = ROOT / "infra" / "supabase" / "identity" / "email-templates" / "recovery.html"
ACCOUNT_EXPORT_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925031000_account_data_export_v1.sql"
ACCOUNT_LIFECYCLE_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-lifecycle" / "index.ts"
ACCOUNT_LIFECYCLE_CONTRACT = ROOT / "docs" / "contracts" / "account-lifecycle.json"


class AccountSyncAndIdentityV1Tests(unittest.TestCase):
    def test_sync_contract_records_applied_backend_without_claiming_public_rollout(self):
        contract = json.loads(SYNC_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["backend"]["status"], "applied")
        self.assertTrue(contract["backend"]["rls_owner_scoped"])
        self.assertTrue(contract["backend"]["idempotent_mutations"])
        self.assertTrue(contract["backend"]["optimistic_conflict_detection"])
        self.assertFalse(contract["mvp_availability"]["synchronization_available"])
        self.assertTrue(contract["mvp_availability"]["client_integration_available"])
        self.assertTrue(contract["backend"]["incremental_cursor_implemented"])
        self.assertEqual(
            contract["backend"]["current_read_mode"],
            "atomic-snapshot-plus-paged-incremental-cursor",
        )

    def test_sync_store_is_owner_scoped_and_mutations_are_server_authoritative(self):
        sql = SYNC_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.ordax_sync_objects enable row level security", sql)
        self.assertIn("(select auth.uid()) = owner_user_id", sql)
        self.assertIn("unique (owner_user_id, idempotency_key)", sql)
        self.assertIn("server_revision", sql)
        self.assertIn("tombstone", sql)
        private_sql = (ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925004832_account_sync_private_store_v1.sql").read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.ordax_sync_objects set schema private", private_sql)
        self.assertIn("security invoker", private_sql)
        self.assertIn("set search_path = ''", private_sql)
        self.assertIn("revoke all on function public.ordax_apply_sync_mutation_v1", private_sql)
        self.assertIn("grant execute on function public.ordax_apply_sync_mutation_v1", private_sql)
        self.assertIn("public.ordax_list_sync_objects_v1", private_sql)
        self.assertNotIn("security definer", private_sql)

    def test_incremental_cursor_and_atomic_snapshot_are_source_controlled(self):
        cursor_sql = CURSOR_MIGRATION.read_text(encoding="utf-8").lower()
        snapshot_sql = SNAPSHOT_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("change_seq bigint generated always as identity", cursor_sql)
        self.assertIn("ordax_apply_sync_mutation_v2", cursor_sql)
        self.assertIn("ordax_pull_sync_changes_v1", cursor_sql)
        self.assertIn("security invoker", cursor_sql)
        self.assertIn("ordax_sync_snapshot_v1", snapshot_sql)
        self.assertIn("security invoker", snapshot_sql)
        self.assertNotIn("security definer", cursor_sql)
        self.assertNotIn("security definer", snapshot_sql)

    def test_deployed_edge_gateway_source_uses_user_auth_and_rls_without_service_role(self):
        text = EDGE_GATEWAY.read_text(encoding="utf-8")
        self.assertIn('ordax-account-gateway', text)
        self.assertIn('signInWithPassword', text)
        self.assertIn('refreshSession', text)
        self.assertIn('ordax_apply_sync_mutation_v2', text)
        self.assertIn('ordax_sync_snapshot_v1', text)
        self.assertIn('ordax_pull_sync_changes_v1', text)
        self.assertIn('crossSiteStateChange', text)
        self.assertIn('sec-fetch-site', text)
        self.assertIn('cross-site-request-rejected', text)
        self.assertIn('x-forwarded-host', text)
        self.assertIn('redirectResponse', text)
        self.assertIn('wantsJson', text)
        self.assertIn('path === "/auth/login" && req.method === "GET"', text)
        self.assertIn('path === "/auth/register" && req.method === "GET"', text)
        self.assertIn('redirectResponse("/conta/", cookies)', text)
        self.assertIn("MIN_REGISTRATION_PASSWORD_CHARS = 12", text)
        self.assertIn("registration-password-policy", text)
        self.assertIn("ACCOUNT_RECOVERY_REQUEST_ENABLED = false", text)
        self.assertIn("ACCOUNT_RECOVERY_COMPLETION_ENABLED = false", text)
        self.assertIn("ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL", text)
        self.assertIn("resetPasswordForEmail", text)
        self.assertIn('path === "/auth/recover" && req.method === "POST"', text)
        self.assertIn('path === "/auth/recover/verify" && req.method === "GET"', text)
        self.assertIn('path === "/auth/recover/complete" && req.method === "POST"', text)
        self.assertIn("verifyOtp", text)
        self.assertIn('type: "recovery"', text)
        self.assertIn("RECOVERY_SESSION_MAX_AGE = 10 * 60", text)
        self.assertIn("ordax_recovery", text)
        self.assertIn("ordax_recovery_access", text)
        self.assertIn("ordax_recovery_refresh", text)
        self.assertIn("authenticatedRecovery", text)
        verify_start = text.index("async function verifyRecoveryLink")
        complete_start = text.index("async function updateRecoveryPassword", verify_start)
        verify_source = text[verify_start:complete_start]
        self.assertIn("recoveryCookies(", verify_source)
        self.assertNotIn("sessionCookies(", verify_source)
        self.assertIn("account-recovery-disabled", text)
        self.assertIn("account-recovery-unavailable", text)
        self.assertIn("account-recovery-rate-limited", text)
        self.assertIn("PWNED_PASSWORDS_ORIGIN", text)
        self.assertIn("https://api.pwnedpasswords.com", text)
        self.assertIn('"SHA-1"', text)
        self.assertIn('"Add-Padding": "true"', text)
        self.assertIn('"User-Agent": PWNED_PASSWORDS_USER_AGENT', text)
        self.assertIn("digest.slice(0, 5)", text)
        self.assertIn("screenNewPassword", text)
        self.assertIn('"compromised-password"', text)
        self.assertIn('"password-screening-unavailable"', text)
        recovery_start = text.index("async function updateRecoveryPassword")
        recovery_end = text.index("async function closeAccount", recovery_start)
        recovery_source = text[recovery_start:recovery_end]
        self.assertIn('signOut({ scope: "global" })', recovery_source)
        self.assertNotIn('signOut({ scope: "local" })', recovery_source)
        self.assertIn("PUBLIC_SITE_ACCOUNT_ENABLED = false", text)
        self.assertIn('ordax_account_export_v1', text)
        self.assertIn('path === "/account/export" && req.method === "GET"', text)
        self.assertIn("x-ordax-public-site", text)
        self.assertIn("publicSiteRequest", text)
        self.assertIn("public-account-access-disabled", text)
        self.assertIn('Accept', (ROOT / "system" / "surface" / "runtime" / "native_account_gateway.py").read_text(encoding="utf-8"))
        self.assertIn("SUPABASE_SECRET_KEYS", text)
        self.assertEqual(text.count("SUPABASE_SERVICE_ROLE_KEY"), 1)
        self.assertIn("ordax_begin_account_registration_legal_intent_v1", text)
        sync_start = text.index('if (path === "/sync/snapshot"')
        sync_section = text[sync_start:]
        self.assertNotIn("adminClient()", sync_section)
        self.assertNotIn("SUPABASE_SECRET_KEYS", sync_section)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", sync_section)

    def test_account_export_rpc_is_user_scoped_security_invoker(self):
        sql = ACCOUNT_EXPORT_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create or replace function public.ordax_account_export_v1()", sql)
        self.assertIn("security invoker", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("auth.uid()", sql)
        self.assertIn("revoke all on function public.ordax_account_export_v1()", sql)
        self.assertIn("grant execute on function public.ordax_account_export_v1() to authenticated", sql)
        self.assertNotIn("security definer", sql)
        self.assertNotIn("service_role", sql)
        self.assertNotIn("'metadata'", sql)

        edge = EDGE_GATEWAY.read_text(encoding="utf-8")
        self.assertIn('path === "/account/export" && req.method === "GET"', edge)
        self.assertIn('supabase.rpc("ordax_account_export_v1")', edge)
        self.assertIn('path.startsWith("/account/")', edge)

        gateway = GATEWAY.read_text(encoding="utf-8")
        self.assertIn("SupabaseAccountProvider", gateway)
        self.assertIn('if path == "/account/export":', gateway)
        self.assertIn("export_account(access)", gateway)

    def test_account_close_contract_records_implemented_but_disabled_deployment(self):
        contract = json.loads(ACCOUNT_LIFECYCLE_CONTRACT.read_text(encoding="utf-8"))
        close = contract["operations"]["account_close"]
        self.assertTrue(close["implemented"])
        self.assertTrue(close["source_implemented"])
        self.assertTrue(close["gateway_route_deployed"])
        self.assertTrue(close["lifecycle_service_deployed"])
        self.assertEqual(close["lifecycle_service_deployment_revision_observed"], 2)
        self.assertEqual(close["gateway_route_deployment_revision_observed"], 27)
        self.assertEqual(close["gateway_source_version"], 17)
        self.assertEqual(close["gateway_deployed_source_version"], 17)
        self.assertTrue(close["deployment_source_match_verified"])
        self.assertTrue(close["gateway_deployment_source_match_verified"])
        self.assertFalse(close["public_enabled"])
        self.assertFalse(close["lifecycle_service_enabled"])

    def test_account_close_source_is_isolated_disabled_and_requires_fresh_auth(self):
        lifecycle = ACCOUNT_LIFECYCLE_EDGE.read_text(encoding="utf-8")
        edge = EDGE_GATEWAY.read_text(encoding="utf-8")
        gateway = GATEWAY.read_text(encoding="utf-8")

        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", lifecycle)
        self.assertIn("MAX_FRESH_TOKEN_AGE_SECONDS = 5 * 60", lifecycle)
        self.assertIn("auth.getUser(token)", lifecycle)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", lifecycle)
        self.assertIn("auth.admin.deleteUser(userId)", lifecycle)

        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", edge)
        self.assertIn('path === "/account/close" && req.method === "POST"', edge)
        self.assertIn("/functions/v1/ordax-account-lifecycle/close", edge)
        self.assertIn("signInWithPassword", edge)
        close_start = edge.index("async function closeAccount")
        close_end = edge.index("async function credentials", close_start)
        close_source = edge[close_start:close_end]
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", close_source)
        self.assertNotIn("SUPABASE_SECRET_KEYS", close_source)
        self.assertNotIn("adminClient()", close_source)
        self.assertNotIn("auth.admin.deleteUser", edge)

        self.assertIn("ACCOUNT_CLOSE_ENABLED = False", gateway)
        self.assertIn('if path == "/account/close":', gateway)
        self.assertIn("sign_in_with_password", gateway)
        self.assertIn("lifecycle_provider.close_account", gateway)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", gateway)

    def test_native_signed_gateway_config_targets_https_edge_gateway(self):
        value = NATIVE_GATEWAY_CONFIG.read_text(encoding="utf-8").strip()
        self.assertTrue(value.startswith("https://"))
        self.assertIn("/functions/v1/ordax-account-gateway", value)
        self.assertNotIn("?", value)
        self.assertNotIn("#", value)

    def test_two_client_proof_never_embeds_or_prints_account_credentials(self):
        text = TWO_CLIENT_PROOF.read_text(encoding="utf-8")
        self.assertIn("ORDAX_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("ORDAX_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("ORDAX_PROOF_RECEIPT_PATH", text)
        self.assertIn("ACCOUNT_SYNC_TWO_CLIENT_PROOF=PASS", text)
        self.assertIn("prototype-ordax.account-sync-two-client-proof/1", text)
        self.assertIn('"credentials_persisted": False', text)
        self.assertIn('"account_identifier_recorded": False', text)
        self.assertIn('"sensitive_auth_material_recorded": False', text)
        self.assertIn("proof/two-client/", text)
        self.assertNotIn("print(password", text)
        self.assertNotIn("print(email", text)
        self.assertNotIn("service_role", text.lower())

    def test_two_client_proof_workflow_is_manual_secret_backed_and_receipt_only(self):
        text = TWO_CLIENT_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("secrets.ORDAX_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("secrets.ORDAX_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("account-sync-two-client-proof.json", text)
        self.assertIn("ACCOUNT_SYNC_TWO_CLIENT_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("retention-days: 14", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_EMAIL\"", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_PASSWORD\"", text)

    def test_session_revocation_proof_keeps_credentials_and_tokens_ephemeral(self):
        text = SESSION_REVOCATION_PROOF.read_text(encoding="utf-8")
        self.assertIn("ORDAX_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("ORDAX_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("ORDAX_SESSION_REVOCATION_RECEIPT_PATH", text)
        self.assertIn("ACCOUNT_SESSION_REVOCATION_PROOF=PASS", text)
        self.assertIn("prototype-ordax.account-session-revocation-proof/1", text)
        self.assertIn('"revoked_session_restore_rejected": True', text)
        self.assertIn('"session_b_remained_authenticated": True', text)
        self.assertIn('"credentials_persisted": False', text)
        self.assertIn('"sensitive_auth_material_recorded": False', text)
        self.assertIn("revoked-refresh-token-restored-session", text)
        self.assertIn("session-b-was-revoked-by-local-logout", text)
        self.assertIn("canonical_public_origin", text)
        self.assertIn("public-gateway-origin-required", text)
        self.assertNotIn("print(refresh_a", text)
        self.assertNotIn("print(password", text)
        self.assertNotIn("service_role", text.lower())

    def test_session_revocation_workflow_is_manual_secret_backed_and_receipt_only(self):
        text = SESSION_REVOCATION_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("origin:", text)
        self.assertIn("Canonical public HTTPS origin to prove", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("secrets.ORDAX_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("secrets.ORDAX_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("ORDAX_ACCOUNT_GATEWAY_BASE_URL: ${{ inputs.origin }}", text)
        self.assertIn('data["gateway_origin"] == "${{ inputs.origin }}".rstrip("/")', text)
        self.assertIn("account-session-revocation-proof.json", text)
        self.assertIn("ACCOUNT_SESSION_REVOCATION_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("retention-days: 14", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_EMAIL\"", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_PASSWORD\"", text)

    def test_recovery_email_template_uses_server_side_token_hash(self):
        text = RECOVERY_EMAIL_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("{{ .RedirectTo }}?token_hash={{ .TokenHash }}", text)
        self.assertIn("type=recovery", text)
        self.assertNotIn("{{ .ConfirmationURL }}", text)
        self.assertNotIn("access_token", text)
        self.assertNotIn("refresh_token", text)

    def test_account_close_disabled_proof_is_credential_free_and_fail_closed(self):
        text = ACCOUNT_CLOSE_DISABLED_PROOF.read_text(encoding="utf-8")
        self.assertIn("ACCOUNT_CLOSE_DISABLED_PROOF=PASS", text)
        self.assertIn('"/account/close"', text)
        self.assertIn('"account-close-disabled"', text)
        self.assertNotIn("ORDAX_PROOF_ACCOUNT_PASSWORD", text)
        self.assertNotIn("Authorization", text)
        self.assertNotIn("service_role", text.lower())

    def test_identity_gateway_keeps_provider_tokens_out_of_browser_javascript(self):
        text = GATEWAY.read_text(encoding="utf-8")
        self.assertIn("HttpOnly", text)
        self.assertIn("SameSite=Lax", text)
        self.assertIn("ORDAX_SUPABASE_PUBLISHABLE_KEY", text)
        self.assertNotIn("service_role", text.lower())
        self.assertIn("refresh_session", text)
        self.assertIn("sign_in_with_password", text)
        self.assertIn("sign_up_with_password", text)


if __name__ == "__main__":
    unittest.main()
