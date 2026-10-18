import contextlib
import io
import json
import os
import runpy
import threading
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

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
        self.assertIn("return PUBLIC_RECOVERY_VERIFY_URL;", text)
        self.assertIn("parseRecoveryLink(url, PUBLIC_RECOVERY_VERIFY_PATH)", text)
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
        self.assertIn('"distinct_account_subjects_verified": True', text)
        self.assertIn('"cross_account_isolation_proven": True', text)
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
        self.assertIn("secrets.ORDAX_PROOF_OTHER_ACCOUNT_EMAIL", text)
        self.assertIn("secrets.ORDAX_PROOF_OTHER_ACCOUNT_PASSWORD", text)
        self.assertIn('assert data["cross_account_isolation_proven"] is True', text)
        self.assertIn('assert data["distinct_account_subjects_verified"] is True', text)
        self.assertIn("account-sync-two-client-proof.json", text)
        self.assertIn("ACCOUNT_SYNC_TWO_CLIENT_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("retention-days: 14", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_EMAIL\"", text)
        self.assertNotIn("echo \"$ORDAX_PROOF_ACCOUNT_PASSWORD\"", text)

    def test_two_client_proof_receipt_is_owned_by_one_workflow_step(self):
        text = TWO_CLIENT_WORKFLOW.read_text(encoding="utf-8")
        producer = text.split("      - name: Prove two independent account-sync sessions", 1)[1].split(
            "      - name: Validate sanitized receipt shape", 1
        )[0]
        validator = text.split("      - name: Validate sanitized receipt shape", 1)[1].split(
            "      - name: Upload sanitized continuity proof only", 1
        )[0]
        uploader = text.split("      - name: Upload sanitized continuity proof only", 1)[1]

        self.assertIn("id: continuity", producer)
        self.assertIn('>> "$GITHUB_OUTPUT"', producer)
        self.assertIn("test -s \"$ORDAX_PROOF_RECEIPT_PATH\"", producer)
        self.assertIn("printf 'proof_receipt=%s\\n'", producer)
        self.assertEqual(
            text.count("${{ runner.temp }}/account-sync-two-client-proof.json"), 1,
            "one canonical producer owns the proof receipt path",
        )
        output = "${{ steps.continuity.outputs.proof_receipt }}"
        self.assertIn(output, validator)
        self.assertIn("path: " + output, uploader)
        self.assertNotIn("python - \"$ORDAX_PROOF_RECEIPT_PATH\"", validator)

    def test_two_client_proof_refuses_redirects_before_transferring_credentials(self):
        scope = runpy.run_path(str(TWO_CLIENT_PROOF))
        paths = []

        class RedirectingGateway(BaseHTTPRequestHandler):
            def do_POST(self):
                paths.append(self.path)
                self.send_response(302)
                self.send_header("Content-Type", "application/json")
                self.send_header("Location", "/unexpected")
                self.end_headers()
                self.wfile.write(b'{"error":"redirect-refused"}')

            def do_GET(self):
                paths.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"authenticated":true}')

            def log_message(self, _format, *_args):
                return

        server = HTTPServer(("127.0.0.1", 0), RedirectingGateway)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            proof = scope["Client"](f"http://127.0.0.1:{server.server_port}")
            status, result = proof.request(
                "POST", "/auth/login", b"email=synthetic&password=synthetic",
                "application/x-www-form-urlencoded",
            )
            self.assertEqual(status, 302)
            self.assertEqual(result, {"error": "redirect-refused"})
            self.assertEqual(paths, ["/auth/login"], "the proof must not follow a redirect")
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)

    def test_two_client_proof_rejects_sensitive_and_malformed_gateway_urls(self):
        scope = runpy.run_path(str(TWO_CLIENT_PROOF))
        for origin in (
            "https://name:secret@example.com/functions/v1/ordax-account-gateway",
            "https://example.com:bogus/functions/v1/ordax-account-gateway",
            "https://example.com/functions/v1/ordax-account-gateway?token=secret",
            "http://example.com/functions/v1/ordax-account-gateway",
        ):
            with self.subTest(origin=origin.split("?")[0].split("@")[-1]):
                with patch.dict(os.environ, {
                    "ORDAX_PROOF_ACCOUNT_EMAIL": "synthetic@example.invalid",
                    "ORDAX_PROOF_ACCOUNT_PASSWORD": "synthetic",
                    "ORDAX_PROOF_OTHER_ACCOUNT_EMAIL": "other@example.invalid",
                    "ORDAX_PROOF_OTHER_ACCOUNT_PASSWORD": "synthetic",
                    "ORDAX_ACCOUNT_GATEWAY_BASE_URL": origin,
                }):
                    with self.assertRaisesRegex(SystemExit, "invalid-gateway-url"):
                        scope["main"]()

    def test_manual_continuity_proof_accepts_isolation_and_fails_closed_on_leak_or_logout(self):
        # Deterministic in-process provider simulation. No real account and no
        # cloud service is accessed; production proof still needs separate
        # dedicated identities and the manual workflow.
        for foreign_leak, logout_denied in ((False, False), (True, False), (False, True)):
            with self.subTest(foreign_leak=foreign_leak, logout_denied=logout_denied):
                source = runpy.run_path(str(TWO_CLIENT_PROOF))
                execution = source["main"]
                globals_ = execution.__globals__
                previous_client = globals_["Client"]
                previous_gateway = globals_["gateway_url"]

                class FakeClient:
                    records = {"A": {}, "B": {}}
                    events = {"A": [], "B": []}
                    clients = []

                    def __init__(self, _url):
                        self.owner = None
                        self.logged_out = False
                        FakeClient.clients.append(self)

                    def login(self, email, _password):
                        self.owner = "A" if email == "primary@example.invalid" else "B"

                    def subject(self):
                        return "distinct-subject-" + self.owner

                    def snapshot(self):
                        objects = list(FakeClient.records[self.owner].values())
                        if self.owner == "B" and foreign_leak:
                            objects += list(FakeClient.records["A"].values())
                        return {"cursor": len(FakeClient.events[self.owner]), "objects": objects}

                    def changes(self, after_cursor):
                        values = FakeClient.events[self.owner][after_cursor:]
                        return {"changes": values, "nextCursor": len(FakeClient.events[self.owner])}

                    def mutate(self, change):
                        self.test_owner = self.owner
                        current = FakeClient.records[self.owner].get(change["objectId"])
                        old_revision = current["serverRevision"] if current else 0
                        assert change["baseServerRevision"] == old_revision
                        new_revision = old_revision + 1
                        tombstone = change["operation"] == "delete"
                        event = {
                            "objectId": change["objectId"],
                            "serverRevision": new_revision,
                            "tombstone": tombstone,
                        }
                        FakeClient.records[self.owner][change["objectId"]] = event
                        FakeClient.events[self.owner].append(event)
                        return {
                            **event,
                            "changeCursor": len(FakeClient.events[self.owner]),
                            "applied": True, "conflict": False,
                        }

                    def logout(self):
                        self.logged_out = True
                        if self.owner == "B" and logout_denied:
                            raise RuntimeError("synthetic-logout-refusal")

                globals_["Client"] = FakeClient
                globals_["gateway_url"] = lambda: "https://gateway.example.invalid/functions/v1/ordax-account-gateway"
                try:
                    with tempfile.TemporaryDirectory() as directory:
                        receipt = Path(directory) / "sanitized.json"
                        with patch.dict(os.environ, {
                            "ORDAX_PROOF_ACCOUNT_EMAIL": "primary@example.invalid",
                            "ORDAX_PROOF_ACCOUNT_PASSWORD": "synthetic-primary",
                            "ORDAX_PROOF_OTHER_ACCOUNT_EMAIL": "other@example.invalid",
                            "ORDAX_PROOF_OTHER_ACCOUNT_PASSWORD": "synthetic-other",
                            "ORDAX_PROOF_RECEIPT_PATH": str(receipt),
                            "GITHUB_SHA": "a" * 40,
                        }):
                            with contextlib.redirect_stdout(io.StringIO()) as output:
                                if foreign_leak:
                                    with self.assertRaisesRegex(SystemExit, "cross-account-snapshot-leak"):
                                        execution()
                                elif logout_denied:
                                    with self.assertRaisesRegex(SystemExit, "logout-unconfirmed"):
                                        execution()
                                else:
                                    self.assertEqual(execution(), 0)
                            self.assertTrue(FakeClient.clients)
                            self.assertTrue(all(client.logged_out for client in FakeClient.clients))
                            self.assertEqual(len(FakeClient.events["B"]), 0)
                            self.assertEqual(len(FakeClient.records["A"]), 1)
                            final = next(iter(FakeClient.records["A"].values()))
                            self.assertTrue(final["tombstone"], "even a failed read proof must clean up")
                            if foreign_leak or logout_denied:
                                self.assertFalse(receipt.exists(), "no unproven PASS receipt")
                                self.assertNotIn("ACCOUNT_SYNC_TWO_CLIENT_PROOF=PASS", output.getvalue())
                            else:
                                data = json.loads(receipt.read_text(encoding="utf-8"))
                                self.assertTrue(data["distinct_account_subjects_verified"])
                                self.assertTrue(data["cross_account_isolation_proven"])
                                self.assertTrue(data["proof_object_tombstoned"])
                                self.assertEqual(data["source_commit"], "a" * 40)
                                self.assertIn("ACCOUNT_SYNC_TWO_CLIENT_PROOF=PASS", output.getvalue())
                                serialized = json.dumps(data)
                                self.assertNotIn("primary@example.invalid", serialized)
                                self.assertNotIn("other@example.invalid", serialized)
                finally:
                    globals_["Client"] = previous_client
                    globals_["gateway_url"] = previous_gateway

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
        self.assertIn("https://ordax.com.br/auth/recover/verify?token_hash={{ .TokenHash }}", text)
        self.assertNotIn("{{ .RedirectTo }}", text)
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
