"""Deployment contract tests for the public OrdaX surface.

These tests intentionally separate durable deployment/security invariants from
runtime observations. Runtime versions and provenance are owned by the
canonical deployment contract and its sanitized evidence receipt; the tests do
not freeze superseded gateway revisions as architectural requirements.
"""

from __future__ import annotations

import importlib.util
import json
import re
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def test_web_login_bundle_contains_shared_css_brand_dependency(self):
        # The Site owns these build outputs; OS only composes the narrow
        # identity closure into Web. Do not depend on OS's removed Surface CSS.
        spec = importlib.util.spec_from_file_location("web_login_deployment", ROOT / "tools/vercel/build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "web"
            staged = root / "verified-site"

            def materialize_test_site(_dest):
                staged.mkdir(parents=True, exist_ok=True)
                for relative in module.WEB_IDENTITY_SUPPORT_FILES:
                    target = _dest / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("site-owned-output", encoding="utf-8")
                (_dest / "assets/ordax-design-tokens.css").write_text(
                    "a{background-image:url('./ordax-symbol.png')}", encoding="utf-8")
                (_dest / "assets/ordax-symbol.png").write_bytes(b"pinned-site-symbol")
                (_dest / "config/public-site.json").write_text(
                    json.dumps({"identity": {
                        "login_url": "/auth/login",
                        "turnstile_sitekey": "0x4AAAAAAFR-Kz0Uc9rNW_iE",
                    }}), encoding="utf-8")
                login = _dest / "login/index.html"
                login.parent.mkdir(parents=True, exist_ok=True)
                login.write_text(
                    '<html><head><link href="/assets/site.css" rel="stylesheet">'
                    '<script src="/assets/site.js"></script></head>'
                    '<body><form data-identity-form="login" action="/auth/login"></form>'
                    '<a href="/cadastro/">Cadastro</a></body></html>', encoding="utf-8")
                return "c" * 40

            with patch.object(module, "OUTPUT", output), patch.object(
                module, "build_independent_site_candidate", materialize_test_site
            ):
                module.compose_web_identity_bootstrap("a" * 40)
                css = (output / "assets/ordax-design-tokens.css").read_text(encoding="utf-8")
                dependencies = re.findall(r"url\(\s*['\"]?([^'\")]+)", css)
                self.assertIn("./ordax-symbol.png", dependencies)
                for dependency in dependencies:
                    self.assertTrue((output / "assets" / dependency).is_file(), dependency)
                self.assertEqual((output / "assets/ordax-symbol.png").read_bytes(),
                                 b"pinned-site-symbol")
                module.write_web_deployment_manifest("a" * 40)
                receipt = json.loads((output / module.WEB_DEPLOYMENT_MANIFEST).read_text(encoding="utf-8"))
                self.assertEqual(receipt["site_source_repository"], "ordaxsystems/ordax-site")
                self.assertEqual(receipt["login_runtime_owner"],
                                 "ordaxsystems/ordax-site:site/assets/site.js")
                self.assertIn("assets/ordax-symbol.png", receipt["identity_support_files"])
                self.assertIn("assets/ordax-symbol.png", {item["path"] for item in receipt["files"]})

    def test_web_vercel_skips_proven_linux_usb_only_without_skipping_web_or_native(self):
        """Use real Git commits: skip physical Linux only, never a Web/client change."""
        script = ROOT / "tools/vercel/should_skip_build.sh"
        helper = ROOT / "tools/vercel/web_linux_exclusions.py"
        self.assertTrue(helper.is_file())
        contract = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        boundaries = contract["client_build_independence"]
        linux = (boundaries["windows_package_forbidden_linux_boot_paths"]
                 + boundaries["windows_package_forbidden_linux_shell_paths"])
        self.assertEqual(len(linux), len(set(linux)))

        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            def git(*args):
                result = subprocess.run(["git", *args], cwd=work, text=True,
                                        capture_output=True, check=True)
                return result.stdout.strip()
            def write(relative, content):
                destination = work / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content, encoding="utf-8")
            def commit(label):
                git("add", "-A")
                git("-c", "user.name=OrdaX Proof",
                    "-c", "user.email=ordax-proof@example.invalid",
                    "commit", "-qm", label)
                return git("rev-parse", "HEAD")
            def ignored(previous, current, project="prj_ftACluUqk6i9DoD9GPIwmgURwckP"):
                env = dict(os.environ)
                env.update(VERCEL_PROJECT_ID=project, VERCEL_GIT_PREVIOUS_SHA=previous,
                           VERCEL_GIT_COMMIT_SHA=current)
                return subprocess.run(["sh", str(script)], cwd=work, env=env,
                                      capture_output=True, text=True, check=False).returncode

            git("init", "-q")
            write("docs/contracts/build-autonomy.json", json.dumps(contract))
            write("docs/README.md", "docs only")
            write("system/composition/native/main.mjs", "export const native=true;\n")
            write("system/composition/web/main.tsx", "export const web=true;\n")
            for path in linux:
                write("system/" + path, "#!/bin/sh\nexit 0\n")
            for path in boundaries["linux_only_client_probe_paths"]:
                write("system/" + path, "#!/usr/bin/env python3\nprint('ok')\n")
            package_path = "system/" + boundaries["linux_only_client_package_manifest"]
            write(package_path, "alpine-baselayout\nbusybox\n")
            baseline = commit("real canonical sources")
            self.assertEqual(ignored("", baseline), 1, "first release always builds")
            self.assertEqual(ignored("f" * 40, baseline), 1, "unknown previous build")
            self.assertEqual(ignored(baseline, baseline), 1, "same revision is not proof")
            self.assertEqual(ignored(baseline, "f" * 40), 1, "unknown HEAD")

            write("system/rescue/agent.sh", "#!/bin/sh\nexit 1\n")
            linux_only = commit("Linux-only service changed")
            self.assertEqual(ignored(baseline, linux_only), 0)
            self.assertEqual(ignored(baseline, linux_only,
                                     "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"), 0,
                             "public Site stays on its own producer")

            write("system/entrypoint", "#!/bin/sh\nset -eu\nexit 0\n")
            boot_only = commit("Linux USB entrypoint changed")
            self.assertEqual(ignored(linux_only, boot_only), 0)

            write("system/surface/runtime/physical_ata_probe.py",
                  "#!/usr/bin/env python3\nprint('updated')\n")
            probe_only = commit("Linux-only sysfs diagnostic changed")
            self.assertEqual(ignored(boot_only, probe_only), 0)

            write("system/composition/native/main.mjs", "export const native=false;\n")
            native_changed = commit("shared Native source changed")
            self.assertEqual(ignored(probe_only, native_changed), 1)

            write("system/composition/web/main.tsx", "export const web=false;\n")
            web_changed = commit("Web-only source changed")
            self.assertEqual(ignored(native_changed, web_changed), 1)

            write("docs/README.md", "documentation only")
            docs_only = commit("unrelated docs changed")
            self.assertEqual(ignored(web_changed, docs_only), 0)
            self.assertEqual(ignored(web_changed, docs_only, "wrong-project"), 1)

            write("docs/contracts/build-autonomy.json", "{}")
            missing_owner = commit("source contract removed")
            self.assertEqual(ignored(docs_only, missing_owner), 1)

            write("docs/contracts/build-autonomy.json", json.dumps(contract))
            restored = commit("restore source contract")
            self.assertEqual(ignored(missing_owner, restored), 1,
                             "contract update itself must trigger Web rebuild")

            write("system/rescue/agent.sh", "not a Linux shell source\n")
            tampered = commit("Linux candidate no longer has a POSIX shebang")
            self.assertEqual(ignored(restored, tampered), 1,
                             "unknown source owner cannot skip build")

            write("system/rescue/agent.sh", "#!/bin/sh\nexit 0\n")
            recovered = commit("restore valid POSIX script")
            write(package_path, "alpine-baselayout\nbusybox\npython3\n")
            package_only = commit("Linux Alpine package list changed")
            self.assertEqual(ignored(recovered, package_only), 0,
                             "Alpine manifest must never rebuild the Web client")
            write(package_path, "not valid package text!\n")
            bad_package = commit("unexpected Alpine package manifest syntax")
            self.assertEqual(ignored(package_only, bad_package), 1,
                             "invalid or changed manifest ownership must build")
            write(package_path, "alpine-baselayout\nbusybox\n")
            package_recovered = commit("restore package manifest")
            self.assertEqual(ignored(bad_package, package_recovered), 0,
                             "a verified Alpine-only manifest remains outside Web")

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
            write("docs/contracts/public-site-source.json", '{"commit":"site-a"}')
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

            write("docs/contracts/public-site-source.json", '{"commit":"site-b"}')
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
        self.assertEqual(migration["status"], "dedicated-zone-active-independent-registrar-and-https-verified")
        self.assertTrue(migration["independent_parent_ns_recheck_completed"])
        self.assertEqual(migration["independent_parent_ns_registrar_source"], "https://rdap.registro.br/domain/ordax.com.br")
        proof_path = ROOT / migration["independent_parent_ns_evidence"]
        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        self.assertEqual(proof["domain"], "ordax.com.br")
        self.assertEqual(proof["registry"]["observed_nameservers"], migration["destination_nameservers"])
        self.assertEqual(proof["cloudflare"]["observed_nameservers"], migration["destination_nameservers"])
        self.assertEqual(proof["cloudflare"]["zone_id"], migration["destination_zone_id"])
        self.assertEqual(proof["vercel"]["project_id"], PUBLIC_VERCEL_PROJECT_ID)
        self.assertTrue(proof["https"]["certificate_validation_enabled"])
        self.assertEqual(proof["https"]["www_http_status"], 308)
        self.assertEqual(proof["https"]["account_session_http_status"], 200)
        self.assertFalse(proof["security_scope"]["authenticated_account_e2e_proven"])
        self.assertTrue(proof["security_scope"]["no_legacy_zone_deletion"])
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
            "canonical-public-edge-oidc-bridge-runtime-proven-account-activation-gated",
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
        parity = json.loads((ROOT / edge["current_runtime_source_parity_evidence"]).read_text(encoding="utf-8"))
        historical = json.loads(RUNTIME_EVIDENCE.read_text(encoding="utf-8"))
        self.assertGreaterEqual(edge["deployed_version"], historical["runtime"]["public_gateway"]["version"])
        self.assertEqual(edge["deployed_version"], parity["public_gateway"]["version"])
        self.assertTrue(parity["public_gateway"]["all_deployed_source_files_match_main"])
        self.assertEqual(edge["canonical_project_ref"], "jhfphsjptrpmtnzkpwud")
        self.assertTrue(edge["runtime_provenance_e2e_verified"])
        self.assertTrue(edge["named_inner_service_bridge_provisioned"])
        self.assertTrue(edge["named_inner_service_bridge_runtime_e2e_verified"])
        self.assertEqual(edge["named_inner_service_bridge_http_status"], 200)
        self.assertIsNone(edge["named_inner_service_bridge_diagnostic"])
        self.assertGreaterEqual(edge["inner_gateway_deployed_version"], historical["runtime"]["internal_gateway"]["version"])
        self.assertEqual(edge["inner_gateway_deployed_version"], parity["internal_gateway"]["version"])
        self.assertTrue(parity["internal_gateway"]["all_deployed_source_files_match_main"])
        self.assertFalse(parity["anonymous_transport"]["public_registration_enabled"])
        self.assertFalse(parity["public_auth_gates_changed"])
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

    def test_web_runtime_cutover_owner_and_live_turnstile_hostname_contract(self):
        # Revalidated against the authoritative production Turnstile widget
        # on 2026-10-30. Web's project split does not activate public access.
        web = self.contract["vercel_adapter"]["web_runtime"]
        self.assertEqual(web["project"], "ordax-web")
        self.assertEqual(web["project_id"], "prj_ftACluUqk6i9DoD9GPIwmgURwckP")
        self.assertEqual(web["canonical_origin"], "https://web.ordax.com.br")
        self.assertEqual(web["mount_path"], "/")

        bot = self.contract["bot_protection"]
        self.assertEqual(
            bot["hostname_allowlist"],
            ["ordax.com.br", "web.ordax.com.br", "www.ordax.com.br"],
        )
        self.assertFalse(bot["production_e2e_verified"])
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])

    def test_nginx_adapter_is_loopback_only_and_does_not_replace_vercel_identity(self):
        adapter = self.contract["adapter"]
        self.assertEqual(adapter["kind"], "nginx-loopback-behind-https-terminator")
        self.assertFalse(adapter["public_listener_in_adapter_allowed"])
        self.assertFalse(adapter["provider_specific_browser_api"])
        self.assertIn("127.0.0.1", adapter["real_ip_trusted_sources"])
        self.assertNotIn("service_role", self.nginx.lower())


if __name__ == "__main__":
    unittest.main()
