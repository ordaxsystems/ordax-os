"""Deployment contract tests for the public OrdaX surface.

These tests intentionally separate durable deployment/security invariants from
runtime observations. Runtime versions and provenance are owned by the
canonical deployment contract and its sanitized evidence receipt; the tests do
not freeze superseded gateway revisions as architectural requirements.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"
NGINX = ROOT / "deploy" / "public-site" / "nginx.conf"
VERCEL = ROOT / "vercel.json"
VERCEL_PROXY_ENTRY = ROOT / "api" / "account-proxy.mjs"
VERCEL_PROXY_CORE = ROOT / "lib" / "account-proxy-core.mjs"
RUNTIME_EVIDENCE = ROOT / "docs" / "evidence" / "web-account-runtime-2026-10-16.json"
PUBLIC_VERCEL_PROJECT_ID = "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"


class PublicSiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.nginx = NGINX.read_text(encoding="utf-8")
        self.vercel = json.loads(VERCEL.read_text(encoding="utf-8"))
        self.vercel_proxy_entry = VERCEL_PROXY_ENTRY.read_text(encoding="utf-8")
        self.vercel_proxy = VERCEL_PROXY_CORE.read_text(encoding="utf-8")

    def test_vercel_ignore_build_is_fail_safe_on_first_deploy_and_git_history_gaps(self):
        self.assertEqual(
            self.vercel["ignoreCommand"],
            "sh tools/vercel/should_skip_build.sh",
        )
        self.assertEqual(self.vercel["git"]["deploymentEnabled"], {"**": False, "main": True})
        script = ROOT / "tools" / "vercel" / "should_skip_build.sh"
        self.assertTrue(script.is_file())

        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)

            def git(*args):
                result = subprocess.run(
                    ["git", *args], cwd=work, text=True,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
                )
                return result.stdout.strip()

            def write(path, value):
                target = work / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value, encoding="utf-8")

            def commit(message):
                git("add", "-A")
                git(
                    "-c", "user.name=OrdaX Test",
                    "-c", "user.email=ordax-test@example.invalid",
                    "commit", "-m", message,
                )
                return git("rev-parse", "HEAD")

            def ignored(previous, current, environment="preview"):
                env = dict(os.environ)
                env["VERCEL_GIT_PREVIOUS_SHA"] = previous
                env["VERCEL_GIT_COMMIT_SHA"] = current
                env["VERCEL_ENV"] = environment
                env["VERCEL_PROJECT_ID"] = PUBLIC_VERCEL_PROJECT_ID
                result = subprocess.run(
                    ["sh", str(script)], cwd=work, env=env,
                    capture_output=True, text=True, check=False,
                )
                return result.returncode

            git("init")
            write("sites/public/index.html", "<h1>OrdaX</h1>")
            write("docs/README.md", "initial documentation")
            initial = commit("initial")
            self.assertEqual(ignored("", initial), 1)
            self.assertEqual(ignored(initial, ""), 1)
            self.assertEqual(ignored("f" * 40, initial), 1)
            self.assertEqual(ignored(initial, "f" * 40), 1)

            write("docs/README.md", "documentation only")
            docs_only = commit("unrelated documentation")
            self.assertEqual(ignored(initial, docs_only), 0)
            self.assertEqual(ignored(initial, docs_only, "production"), 0)

            write("sites/public/index.html", "<h1>OrdaX updated</h1>")
            site_change = commit("public site change")
            self.assertEqual(ignored(docs_only, site_change), 1)

    def test_cloudflare_zone_remains_dedicated_and_independently_proven(self):
        migration = self.contract["cloudflare_dns_migration"]
        self.assertEqual(migration["purpose"], "ordax-os-only")
        self.assertEqual(migration["destination_zone_status"], "active")
        self.assertEqual(migration["destination_public_site_proxy_mode"], "dns-only")
        self.assertTrue(migration["destination_dns_only_independent_http_proof_passed"])
        self.assertTrue(migration["registrar_nameserver_update_completed"])
        self.assertTrue(migration["public_delegation_points_to_destination"])
        self.assertTrue(migration["destination_https_and_www_production_revalidated_after_delegation"])
        self.assertFalse(migration["source_zone_may_be_removed"])
        self.assertFalse(migration["legacy_catalog_data_deleted"])

    def test_production_target_is_dedicated_and_preview_cannot_be_identity_authority(self):
        migration = self.contract["vercel_migration"]
        self.assertEqual(migration["target_team_slug"], "ordaxsystems")
        self.assertEqual(migration["target_project"], "ordax-os-public")
        self.assertEqual(migration["target_git_repository"], "ordaxsystems/ordax-os")
        self.assertTrue(migration["target_project_provisioned"])
        self.assertTrue(migration["target_canonical_domain_attached_to_project"])
        self.assertTrue(migration["target_canonical_domain_verified"])
        self.assertEqual(migration["target_canonical_domain"], "ordax.com.br")
        self.assertFalse(migration["personal_scope_allowed"])
        self.assertFalse(migration["legacy_team_allowed_after_cutover"])
        self.assertFalse(migration["shared_secret_fallback_allowed"])
        self.assertFalse(migration["preview_identity_allowed"])
        self.assertFalse(migration["automatic_preview_git_deployments_enabled"])
        self.assertTrue(migration["automatic_production_git_deployments_enabled"])
        self.assertEqual(migration["production_git_branch"], "main")

    def test_live_oidc_and_gateway_transport_are_proven_without_opening_full_account(self):
        self.assertEqual(
            self.contract["status"],
            "canonical-public-edge-v8-oidc-bridge-runtime-proven-account-activation-gated",
        )
        self.assertEqual(
            self.contract["runtime_evidence"],
            "docs/evidence/web-account-runtime-2026-10-16.json",
        )
        self.assertTrue(RUNTIME_EVIDENCE.is_file())

        migration = self.contract["vercel_migration"]
        self.assertTrue(migration["target_runtime_oidc_e2e_verified"])
        self.assertEqual(migration["target_canonical_domain_account_session_http_status"], 200)
        self.assertEqual(migration["target_canonical_domain_registration_policy_http_status"], 200)
        self.assertEqual(migration["target_canonical_domain_identity_mode_observed"], "auth-only")
        self.assertFalse(migration["target_canonical_domain_account_activation_ready_observed"])
        self.assertFalse(migration["target_canonical_domain_recovery_configured_observed"])
        self.assertFalse(migration["target_project_production_public_account_routes_available"])

        adapter = self.contract["vercel_adapter"]
        self.assertEqual(adapter["status"], "oidc-zero-trust-production-runtime-proven")
        self.assertTrue(adapter["canonical_public_origin_live_configured"])
        self.assertTrue(adapter["canonical_public_origin_deployment_verified"])
        self.assertTrue(adapter["product_cookie_envelope_deployed"])
        self.assertFalse(adapter["shared_proxy_secret_required"])
        self.assertFalse(adapter["browser_authorization_forwarded"])

        edge = self.contract["public_edge_gateway"]
        self.assertTrue(edge["deployed"])
        self.assertEqual(edge["deployed_version"], 8)
        self.assertEqual(edge["canonical_project_ref"], "jhfphsjptrpmtnzkpwud")
        self.assertTrue(edge["runtime_provenance_e2e_verified"])
        self.assertTrue(edge["named_inner_service_bridge_provisioned"])
        self.assertTrue(edge["named_inner_service_bridge_runtime_e2e_verified"])
        self.assertEqual(edge["named_inner_service_bridge_http_status"], 200)
        self.assertIsNone(edge["named_inner_service_bridge_diagnostic"])
        self.assertEqual(edge["inner_gateway_deployed_version"], 13)
        self.assertFalse(edge["inner_gateway_platform_verify_jwt"])
        self.assertFalse(edge["oidc_authorization_forwarded_to_inner_gateway"])
        self.assertFalse(edge["sensitive_proxy_headers_forwarded_to_inner_gateway"])
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])

    def test_historical_artifact_receipts_are_not_mislabeled_as_current_gateway_versions(self):
        edge = self.contract["public_edge_gateway"]
        self.assertEqual(edge["deployment_source_commit_observation_version"], 3)
        self.assertEqual(edge["deployment_artifact_sha256_observation_version"], 3)
        self.assertEqual(len(edge["deployment_artifact_sha256"]), 64)
        self.assertNotEqual(edge["deployed_version"], edge["deployment_artifact_sha256_observation_version"])

    def test_routing_uses_ordax_platform_and_same_origin_boundaries(self):
        routing = self.contract["routing"]
        self.assertEqual(routing["deployed_account_gateway"], "ordax-platform:ordax-account-gateway")
        self.assertTrue(routing["public_edge_gateway_required_for_vercel"])
        self.assertTrue(routing["public_edge_gateway_deployed"])
        self.assertTrue(routing["vercel_adapter_routed_to_public_edge_gateway"])
        self.assertTrue(routing["same_origin_identity_required"])
        self.assertTrue(routing["same_origin_sync_required"])
        self.assertTrue(routing["same_origin_account_required"])
        self.assertTrue(routing["gateway_public_activation_gate_required"])
        self.assertFalse(routing["gateway_public_activation_currently_enabled"])

    def test_vercel_proxy_remains_zero_trust_and_fail_closed(self):
        adapter = self.contract["vercel_adapter"]
        self.assertEqual(adapter["project"], "ordax-os-public")
        self.assertEqual(adapter["team"], "ordaxsystems")
        self.assertEqual(adapter["canonical_public_origin"], "https://ordax.com.br")
        self.assertTrue(adapter["incoming_request_origin_must_equal_canonical_origin"])
        self.assertFalse(adapter["browser_host_header_trusted"])
        self.assertTrue(adapter["state_change_exact_browser_origin_required"])
        self.assertTrue(adapter["state_change_sec_fetch_site_same_origin_required"])
        self.assertTrue(adapter["state_change_missing_origin_fails_closed"])
        self.assertTrue(adapter["gateway_url_must_be_https"])
        self.assertFalse(adapter["direct_inner_gateway_target_allowed"])
        self.assertTrue(adapter["set_cookie_validation_required"])
        self.assertFalse(adapter["set_cookie_domain_attribute_allowed"])
        self.assertTrue(adapter["set_cookie_secure_required"])
        self.assertTrue(adapter["set_cookie_http_only_required"])
        self.assertFalse(adapter["upstream_absolute_redirect_allowed"])
        self.assertFalse(adapter["upstream_protocol_relative_redirect_allowed"])
        self.assertEqual(
            self.vercel_proxy_entry,
            'export * from "../lib/account-proxy-core.mjs";\n'
            'export { default } from "../lib/account-proxy-core.mjs";\n',
        )
        self.assertIn("getVercelOidcToken", self.vercel_proxy)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", self.vercel_proxy)

    def test_public_edge_service_bridge_is_named_and_never_browser_authority(self):
        edge = self.contract["public_edge_gateway"]
        self.assertEqual(edge["inner_gateway_authentication"], "backend-secret-apikey")
        self.assertTrue(edge["proxy_authentication_required"])
        self.assertTrue(edge["custom_proxy_authentication"])
        self.assertFalse(edge["shared_proxy_secret_required"])
        self.assertTrue(edge["trusted_client_address_requires_authenticated_proxy"])
        self.assertTrue(edge["trusted_public_origin_requires_authenticated_proxy"])
        self.assertTrue(edge["rate_limit_rpc_service_role_only"])
        self.assertTrue(edge["rate_limit_fail_closed"])

    def test_security_headers_and_cache_boundaries_are_fail_closed(self):
        requirements = self.contract["production_requirements"]
        for name in (
            "https",
            "hsts_required",
            "cross_origin_process_isolation_required",
            "origin_agent_cluster_required",
            "host_adapter_must_preserve_auth_status_codes",
            "host_adapter_must_preserve_session_set_cookie",
            "public_proxy_vercel_production_oidc_required",
            "public_proxy_must_bind_to_canonical_origin",
            "public_state_changes_must_require_exact_origin_and_fetch_metadata",
            "public_proxy_must_reject_untrusted_upstream_redirects_and_cookies",
            "preview_oidc_must_not_access_production_account_boundary",
            "public_auth_rate_limits_required",
            "public_auth_turnstile_required",
            "turnstile_server_side_siteverify_required",
        ):
            self.assertTrue(requirements[name], name)

        headers = self.contract["security_headers"]
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn("includeSubDomains", headers["Strict-Transport-Security"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertEqual(self.contract["cache_policy"]["identity"], "no-store")
        self.assertEqual(self.contract["cache_policy"]["account"], "no-store")

    def test_rate_limits_and_turnstile_remain_required_even_with_live_transport(self):
        rate_limits = self.contract["security_rate_limits"]
        self.assertTrue(rate_limits["authoritative_backend"]["deployed"])
        self.assertFalse(rate_limits["authoritative_backend"]["raw_client_ip_persisted"])
        self.assertTrue(rate_limits["native_direct"]["fail_closed"])
        self.assertTrue(rate_limits["public_edge"]["deployed"])
        self.assertEqual(rate_limits["public_edge"]["deployment_revision_observed"], 8)

        bot = self.contract["bot_protection"]
        self.assertEqual(bot["provider"], "cloudflare-turnstile")
        self.assertTrue(bot["server_side_verification_required"])
        self.assertTrue(bot["production_secret_configured"])
        self.assertFalse(bot["production_e2e_verified"])
        self.assertFalse(bot["secret_may_exist_in_repository"])
        self.assertFalse(bot["token_forwarded_to_inner_gateway"])

    def test_web_runtime_cutover_ssot_matches_canonical_domain_ownership(self):
        web = self.contract["vercel_adapter"]["web_runtime"]
        self.assertEqual(web["project"], "ordax-web")
        self.assertEqual(web["project_id"], "prj_ftACluUqk6i9DoD9GPIwmgURwckP")
        self.assertEqual(web["canonical_origin"], "https://web.ordax.com.br")
        self.assertEqual(web["mount_path"], "/")
        self.assertFalse(web["domain_project_move_pending"])
        self.assertEqual(web["domain_current_project"], "ordax-web")
        self.assertEqual(web["domain_target_project"], "ordax-web")

        bot = self.contract["bot_protection"]
        self.assertEqual(
            bot["hostname_allowlist"],
            ["ordax.com.br", "web.ordax.com.br", "www.ordax.com.br"],
        )
        self.assertFalse(bot["production_e2e_verified"])
    def test_nginx_adapter_is_loopback_only_and_does_not_replace_vercel_identity(self):
        adapter = self.contract["adapter"]
        self.assertEqual(adapter["kind"], "nginx-loopback-behind-https-terminator")
        self.assertFalse(adapter["public_listener_in_adapter_allowed"])
        self.assertFalse(adapter["provider_specific_browser_api"])
        self.assertIn("127.0.0.1", adapter["real_ip_trusted_sources"])
        self.assertNotIn("service_role", self.nginx.lower())


if __name__ == "__main__":
    unittest.main()
