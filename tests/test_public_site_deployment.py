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
VERCEL_PROXY = ROOT / "api" / "account-proxy.mjs"
DEPLOYMENT_PROOF = ROOT / "tools" / "public-site" / "prove_deployment.py"
PUBLIC_EDGE_RATE_LIMIT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_auth_rate_limit.mjs"
SHARED_AUTH_RATE_LIMIT = ROOT / "infra" / "supabase" / "functions" / "_shared" / "auth_rate_limit.mjs"


class PublicSiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.nginx = NGINX.read_text(encoding="utf-8")
        self.vercel = json.loads(VERCEL.read_text(encoding="utf-8"))
        self.vercel_proxy = VERCEL_PROXY.read_text(encoding="utf-8")

    def test_vercel_ignore_build_is_fail_safe_on_first_deploy_and_git_history_gaps(self):
        self.assertEqual(
            self.vercel["ignoreCommand"],
            "sh tools/public-site/should_skip_vercel_build.sh",
        )
        self.assertFalse(self.vercel["git"]["deploymentEnabled"])
        script = ROOT / "tools/public-site/should_skip_vercel_build.sh"
        self.assertTrue(script.is_file())

        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            def git(*args):
                result = subprocess.run(
                    ["git", *args], cwd=work, text=True,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    check=True,
                )
                return result.stdout.strip()

            def write(path, value):
                target = work / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value, encoding="utf-8")

            def commit(message):
                git("add", "-A")
                git("-c", "user.name=OrdaX Test",
                    "-c", "user.email=ordax-test@example.invalid",
                    "commit", "-m", message)
                return git("rev-parse", "HEAD")

            def ignored(previous, current):
                env = dict(os.environ)
                env["VERCEL_GIT_PREVIOUS_SHA"] = previous
                env["VERCEL_GIT_COMMIT_SHA"] = current
                result = subprocess.run(
                    ["sh", str(script)], cwd=work, env=env,
                    capture_output=True, text=True, check=False,
                )
                return result.returncode

            git("init")
            write("sites/public/index.html", "<h1>OrdaX</h1>")
            write("docs/README.md", "initial documentation")
            initial = commit("initial")
            # First deployment, missing current ref and a shallow history
            # must BUILD (1), not skip (0) or fatal-exit (128).
            self.assertEqual(ignored("", initial), 1)
            self.assertEqual(ignored(initial, ""), 1)
            self.assertEqual(ignored("f" * 40, initial), 1)
            self.assertEqual(ignored(initial, "f" * 40), 1)

            write("docs/README.md", "documentation only")
            docs_only = commit("unrelated documentation")
            self.assertEqual(ignored(initial, docs_only), 0)

            write("sites/public/index.html", "<h1>OrdaX updated</h1>")
            site_change = commit("public site change")
            self.assertEqual(ignored(docs_only, site_change), 1)

            write("infra/supabase/functions/_shared/bounded_body.mjs",
                  "export const bound = 64;")
            shared_change = commit("shared HTTP boundary change")
            self.assertEqual(ignored(site_change, shared_change), 1)

            write("package.json", '{"private": true}')
            dependency_change = commit("dependency changed")
            self.assertEqual(ignored(shared_change, dependency_change), 1)

            write("platform/releases/publications.json", '{"status":"no-public-releases","releases":[]}')
            releases_change = commit("public release owner changed")
            self.assertEqual(ignored(dependency_change, releases_change), 1)

            write("tools/public-site/build.py", "# canonical site builder changed")
            builder_change = commit("canonical site builder changed")
            self.assertEqual(ignored(releases_change, builder_change), 1)

    def test_cloudflare_exclusive_zone_is_active_with_independent_runtime_proof_pending(self):
        migration = self.contract["cloudflare_dns_migration"]
        self.assertEqual(migration["purpose"], "ordax-os-only")
        self.assertEqual(
            migration["status"], "dedicated-zone-active-post-delegation-http-revalidation-pending"
        )
        self.assertEqual(migration["destination_account_id"], "42586bf13b61436219d21def299833e4")
        self.assertEqual(migration["destination_zone_id"], "f7273428d0643fab66349dc0cbd9d244")
        self.assertEqual(
            migration["destination_nameservers"],
            ["martin.ns.cloudflare.com", "meg.ns.cloudflare.com"],
        )
        self.assertEqual(migration["source_zone_status"], "moved")
        self.assertEqual(migration["destination_zone_status"], "active")
        self.assertEqual(migration["destination_dns_records_count"], 4)
        self.assertEqual(
            set(migration["destination_dns_record_names"]),
            {"ordax.com.br", "www.ordax.com.br", "_vercel.ordax.com.br"},
        )
        self.assertEqual(migration["source_dnssec_status"], "disabled")
        self.assertEqual(migration["destination_dnssec_status"], "disabled")
        self.assertFalse(migration["destination_legacy_catalog_media_dns_record_present"])
        self.assertEqual(migration["destination_legacy_catalog_worker_routes_count"], 0)
        self.assertEqual(migration["destination_legacy_catalog_cache_rulesets_count"], 0)
        self.assertFalse(migration["legacy_catalog_data_deleted"])
        self.assertTrue(migration["registrar_nameserver_update_completed"])
        self.assertTrue(migration["public_delegation_points_to_destination"])
        self.assertIn("legacy zone reports moved", migration["note"])
        self.assertFalse(migration["independent_parent_ns_recheck_completed"])
        self.assertFalse(
            migration["destination_https_and_www_production_revalidated_after_delegation"]
        )
        self.assertFalse(migration["source_zone_may_be_removed"])
        self.assertEqual(
            self.contract["vercel_migration"]["target_dns_zone_owner_account"],
            "ordaxos-exclusive-cloudflare-account",
        )

    def test_vercel_migration_target_is_dedicated_and_fail_closed(self):
        migration = self.contract["vercel_migration"]
        self.assertEqual(
            migration["status"],
            "target-static-production-canonical-domain-live-identity-runtime-pending",
        )
        self.assertTrue(migration["target_project_provisioned"])
        self.assertEqual(migration["target_project_id"], "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC")
        self.assertEqual(migration["target_git_repository"], "ordaxsystems/ordax-os")
        self.assertTrue(migration["target_project_assigned_domain_verified"])
        self.assertEqual(migration["target_project_assigned_domain"], "ordax-os-public-tau.vercel.app")
        self.assertFalse(migration["expected_production_domain_bound"])
        self.assertIn("owned-on-other-team", migration["expected_production_domain_block_reason"])
        self.assertTrue(migration["target_project_preview_deployment_ready"])
        self.assertFalse(migration["target_project_preview_deployment_is_production"])
        self.assertTrue(migration["target_project_production_deployment_ready"])
        self.assertEqual(migration["target_project_production_deployment_scope"], "static-public-site-only-no-auth-runtime-proof")
        self.assertEqual(migration["target_project_production_deployment_id"], "dpl_66jvy7HYTzGyevgnNawtTJfH2Bgq")
        self.assertEqual(migration["target_project_production_deployment_commit"], "ddbaa362e2d586f76fd1ed878eb81414a5dee78a")
        self.assertTrue(migration["target_project_production_http_smoke_verified"])
        self.assertFalse(migration["target_project_production_public_account_routes_available"])
        self.assertEqual(migration["target_canonical_domain"], "ordax.com.br")
        self.assertTrue(migration["target_canonical_domain_attached_to_project"])
        self.assertTrue(migration["target_canonical_domain_verified"])
        self.assertEqual(migration["target_www_domain"], "www.ordax.com.br")
        self.assertTrue(migration["target_www_domain_attached_to_project"])
        self.assertTrue(migration["target_www_domain_verified"])
        self.assertEqual(migration["target_www_domain_redirect_status"], 308)
        self.assertTrue(migration["target_domain_claim_txt_published"])
        self.assertTrue(migration["target_domain_claim_txt_dns_publicly_resolved"])
        self.assertTrue(migration["target_dns_apex_routing_cutover_verified"])
        self.assertIsNone(migration["target_domain_claim_pending_reason"])
        self.assertTrue(migration["target_legacy_verification_txt_removed"])
        self.assertTrue(migration["target_canonical_domain_https_verified"])
        self.assertTrue(migration["target_dns_apex_content_matches_new_project"])
        self.assertTrue(migration["target_www_redirect_https_verified"])
        self.assertEqual(migration["target_canonical_domain_http_status"], 200)
        self.assertEqual(migration["target_www_redirect_http_status"], 308)
        self.assertEqual(migration["target_canonical_domain_account_session_http_status"], 503)
        self.assertEqual(migration["target_canonical_domain_sync_http_status"], 503)
        self.assertEqual(migration["target_canonical_domain_unknown_route_http_status"], 404)
        self.assertFalse(migration["target_legacy_project_dashboard_detachment_verified"])
        self.assertFalse(migration["target_runtime_oidc_e2e_verified"])
        self.assertFalse(migration["target_runtime_oidc_e2e_verified"])
        self.assertFalse(migration["target_project_environment_variables_present"])
        self.assertEqual(migration["target_account_email"], "ordaxos@gmail.com")
        self.assertEqual(migration["target_team_slug"], "ordaxsystems")
        self.assertEqual(migration["target_project"], "ordax-os-public")
        self.assertEqual(migration["target_github_organization"], "ordaxsystems")
        self.assertFalse(migration["personal_scope_allowed"])
        self.assertFalse(migration["legacy_team_allowed_after_cutover"])
        self.assertFalse(migration["shared_secret_fallback_allowed"])
        self.assertFalse(migration["preview_identity_allowed"])
        self.assertEqual(
            migration["cutover_atomic_fields"],
            [
                "oidc_issuer",
                "oidc_audience",
                "oidc_subject",
                "canonical_public_origin",
            ],
        )
        self.assertTrue(migration["runtime_proof_required_before_public_auth"])
        self.assertTrue(migration["automatic_git_deployments_frozen"])
        self.assertTrue(migration["reenable_git_deployments_only_after_new_team_runtime_proof"])
        self.assertEqual(self.vercel["git"]["deploymentEnabled"], False)
        self.assertEqual(
            migration["target_team_slug"],
            self.contract["vercel_adapter"]["team"],
        )

    def test_contract_records_live_oidc_v7_without_claiming_vercel_rollout(self):
        self.assertEqual(
            self.contract["status"],
            "public-edge-oidc-v7-live-cookie-envelope-shared-auth-rate-limit-vercel-source-not-deployed",
        )
        self.assertEqual(
            self.contract["vercel_adapter"]["status"],
            "oidc-zero-trust-source-ready-not-deployed",
        )
        edge = self.contract["public_edge_gateway"]
        self.assertTrue(edge["deployed"])
        self.assertEqual(edge["deployed_version"], 7)
        self.assertEqual(
            edge["deployment_source_commit"],
            "735ef1da0a00f92fc28e9c14bbe0765d304e733e",
        )
        self.assertEqual(edge["deployed_authentication"], "vercel-production-oidc-v2")
        self.assertEqual(edge["source_authentication"], "vercel-production-oidc-v2")
        self.assertTrue(edge["oidc_source_ready"])
        self.assertTrue(edge["oidc_deployed"])
        self.assertFalse(edge["runtime_provenance_e2e_verified"])
        self.assertFalse(edge["oidc_preview_allowed"])
        self.assertTrue(edge["request_context_validation_connected"])
        self.assertTrue(edge["trusted_public_origin_requires_authenticated_proxy"])
        self.assertEqual(edge["trusted_client_address_canonicalization"], "strict-ipv4-ipv6")
        self.assertTrue(edge["ambiguous_client_address_rejected"])
        rate_limit_source = PUBLIC_EDGE_RATE_LIMIT.read_text(encoding="utf-8")
        shared_rate_limit = SHARED_AUTH_RATE_LIMIT.read_text(encoding="utf-8")
        self.assertIn("canonicalizePublicClientAddress", rate_limit_source)
        self.assertIn("canonicalizeClientAddress", rate_limit_source)
        self.assertIn("canonicalIpv4", shared_rate_limit)
        self.assertIn("canonicalIpv6", shared_rate_limit)
        self.assertIn("authRateLimitBucket", shared_rate_limit)
        self.assertNotIn("const ADDRESS_RE", shared_rate_limit)
        self.assertTrue(self.contract["routing"]["public_edge_gateway_deployed"])
        self.assertFalse(self.contract["routing"]["vercel_adapter_routed_to_public_edge_gateway"])

        self.assertTrue(edge["product_cookie_envelope_emission_deployed"])
        self.assertEqual(edge["product_cookie_envelope_header"], "x-ordax-cookie-envelope")
        self.assertFalse(edge["transport_set_cookie_forwarding"])
        vercel = self.contract["vercel_adapter"]
        self.assertTrue(vercel["product_cookie_envelope_source_ready"])
        self.assertFalse(vercel["product_cookie_envelope_deployed"])
        self.assertFalse(vercel["transport_set_cookie_forwarded"])

    def test_adapter_is_loopback_only_and_routes_only_account_prefixes_to_gateway(self):
        self.assertIn("listen 127.0.0.1:8080;", self.nginx)
        self.assertIn("location ~ ^/(auth|sync)/", self.nginx)
        self.assertIn("/functions/v1/ordax-account-gateway$1", self.nginx)
        self.assertNotIn("listen 0.0.0.0", self.nginx)
        self.assertNotIn("service_role", self.nginx.lower())
        self.assertIn("proxy_set_header X-OrdaX-Public-Site 1;", self.nginx)
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])

    def test_public_surface_enforces_transport_and_cross_origin_isolation(self):
        expected = {
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Origin-Agent-Cluster": "?1",
            "X-Permitted-Cross-Domain-Policies": "none",
        }
        contract_headers = self.contract["security_headers"]
        vercel_headers = {
            item["key"]: item["value"]
            for rule in self.vercel["headers"]
            if rule["source"] == "/(.*)"
            for item in rule["headers"]
        }
        for name, value in expected.items():
            self.assertEqual(contract_headers[name], value)
            self.assertEqual(vercel_headers[name], value)
            self.assertIn(f'add_header {name} "{value}" always;', self.nginx)
        self.assertIn("upgrade-insecure-requests", contract_headers["Content-Security-Policy"])
        self.assertIn("upgrade-insecure-requests", vercel_headers["Content-Security-Policy"])
        csp = contract_headers["Content-Security-Policy"]
        self.assertIn("script-src 'self' https://challenges.cloudflare.com", csp)
        self.assertIn("frame-src https://challenges.cloudflare.com", csp)
        self.assertIn("connect-src 'self' https://challenges.cloudflare.com", csp)
        self.assertNotIn("'unsafe-inline'", csp)
        self.assertNotIn("'unsafe-eval'", csp)
        requirements = self.contract["production_requirements"]
        self.assertTrue(requirements["hsts_required"])
        self.assertTrue(requirements["cross_origin_process_isolation_required"])
        self.assertTrue(requirements["origin_agent_cluster_required"])
        self.assertTrue(requirements["legacy_cross_domain_policy_disabled"])

    def test_vercel_static_cache_rules_match_delivery_contract(self):
        policy = self.contract["cache_policy"]
        cache_rules = {}
        for route in self.vercel["headers"]:
            values = [entry["value"] for entry in route["headers"]
                      if entry["key"].lower() == "cache-control"]
            if not values:
                continue
            self.assertEqual(len(values), 1, route["source"])
            self.assertNotIn(route["source"], cache_rules)
            cache_rules[route["source"]] = values[0]

        self.assertEqual(cache_rules["/"], "no-cache, must-revalidate")
        self.assertEqual(cache_rules["/index.html"], "no-cache, must-revalidate")
        self.assertIn(policy["html"], cache_rules["/"])
        for route in ("download", "login", "cadastro", "recuperar",
                      "conta", "licencas", "privacidade", "termos"):
            self.assertIn(policy["html"], cache_rules[f"/{route}/:path*"])
        self.assertEqual(cache_rules["/config/public-site.json"],
                         f'{policy["config"]}, max-age=0')
        self.assertEqual(cache_rules["/releases/catalog.json"],
                         f'{policy["release_catalog"]}, max-age=0')
        self.assertEqual(cache_rules["/assets/:path*"], policy["assets"])
        for route in ("/auth/:path*", "/sync/:path*", "/account/:path*"):
            self.assertIn(policy["identity"], cache_rules[route])
        self.assertNotIn("/(.*)", cache_rules)

    def test_turnstile_is_server_verified_and_secret_never_belongs_to_site_source(self):
        bot = self.contract["bot_protection"]
        self.assertEqual(bot["provider"], "cloudflare-turnstile")
        self.assertEqual(bot["sitekey"], "0x4AAAAAAFP2xxwpJ9Bl_5Ka")
        self.assertEqual(bot["hostname_allowlist"], ["ordax.com.br"])
        self.assertFalse(bot["production_hostname_verified"])
        self.assertIn("pending real Cloudflare Turnstile", bot["production_hostname_verification_evidence"])
        self.assertEqual(bot["action"], "ordax-account")
        self.assertEqual(bot["protected_paths"], ["/auth/login", "/auth/register", "/auth/recover"])
        self.assertTrue(bot["server_side_verification_required"])
        self.assertEqual(bot["secret_environment_variable"], "ORDAX_TURNSTILE_SECRET_KEY")
        self.assertFalse(bot["secret_may_exist_in_repository"])
        self.assertFalse(bot["token_forwarded_to_inner_gateway"])
        self.assertFalse(bot["production_secret_configured"])
        self.assertFalse(bot["production_e2e_verified"])
        self.assertTrue(self.contract["production_requirements"]["public_auth_turnstile_required"])
        self.assertTrue(self.contract["production_requirements"]["turnstile_server_side_siteverify_required"])

    def test_host_neutral_adapter_keeps_rate_limits_as_defense_in_depth(self):
        self.assertIn("ordax_auth_credentials:10m rate=10r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_request:10m rate=3r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_completion:10m rate=10r/m", self.nginx)
        self.assertIn("limit_req_status 429;", self.nginx)
        self.assertFalse(self.contract["adapter"]["public_auth_rate_limit_deployed"])
        self.assertTrue(self.contract["security_rate_limits"]["authoritative_backend"]["deployed"])
        native = self.contract["security_rate_limits"]["native_direct"]
        self.assertTrue(native["source_ready"])
        self.assertTrue(native["deployed"])
        self.assertEqual(native["client_address_source"], "supabase-edge-cf-connecting-ip")
        self.assertEqual(native["rpc"], "ordax_consume_public_auth_rate_limit_v1")
        self.assertTrue(native["shares_public_ip_window"])
        self.assertTrue(native["fail_closed"])
        self.assertFalse(native["raw_client_ip_persisted"])
        self.assertEqual(native["deployment_revision_observed"], 27)
        self.assertTrue(native["shared_policy_deployed"])
        public_edge_rate_limit = self.contract["security_rate_limits"]["public_edge"]
        self.assertTrue(public_edge_rate_limit["deployed"])
        self.assertEqual(public_edge_rate_limit["deployment_revision_observed"], 7)
        self.assertTrue(public_edge_rate_limit["shared_policy_deployed"])

    def test_vercel_routes_auth_sync_and_bounded_account_surface_through_server_function(self):
        self.assertEqual(self.vercel["outputDirectory"], "out/public-site")
        self.assertEqual(self.contract["vercel_adapter"]["static_output_directory"], "out/public-site")
        self.assertEqual(self.vercel["buildCommand"], "python3 tools/public-site/build.py check && python3 tools/public-site/build.py build --source-commit \"$VERCEL_GIT_COMMIT_SHA\" && python3 tools/public-site/build.py verify")
        rewrites = {item["source"]: item["destination"] for item in self.vercel["rewrites"]}
        self.assertEqual(rewrites["/auth/:path*"], "/api/account-proxy?ordax_path=/auth/:path*")
        self.assertEqual(rewrites["/sync/:path*"], "/api/account-proxy?ordax_path=/sync/:path*")
        self.assertEqual(rewrites["/account/:path*"], "/api/account-proxy?ordax_path=/account/:path*")
        self.assertIn('const MAX_BODY_BYTES = 64 * 1024;', self.vercel_proxy)
        self.assertIn('const ALLOWED_PREFIXES = ["/auth/", "/sync/"];', self.vercel_proxy)
        self.assertIn('const PUBLIC_ACCOUNT_ROUTES = new Map([', self.vercel_proxy)
        self.assertIn('import("@vercel/oidc")', self.vercel_proxy)
        self.assertIn("runtime.getVercelOidcToken", self.vercel_proxy)
        self.assertIn("resolveVercelOidcToken", self.vercel_proxy)
        self.assertNotIn("process.env.VERCEL_OIDC_TOKEN", self.vercel_proxy)
        self.assertIn('process.env.ORDAX_PUBLIC_ORIGIN', self.vercel_proxy)
        self.assertIn('verifyBrowserOriginContext(request, trustedPublicOrigin)', self.vercel_proxy)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.vercel_proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.vercel_proxy)
        self.assertIn('headers.set("x-forwarded-host", canonical.host)', self.vercel_proxy)
        self.assertIn('headers.set("x-ordax-public-origin", trustedPublicOrigin)', self.vercel_proxy)
        self.assertIn('/functions/v1/ordax-public-account-gateway', self.vercel_proxy)
        self.assertNotIn('request.headers.get("host")', self.vercel_proxy)
        self.assertNotIn('ORDAX_PUBLIC_PROXY_SECRET', self.vercel_proxy)
        self.assertNotIn('x-ordax-public-proxy-secret', self.vercel_proxy)
        self.assertNotIn("service_role", self.vercel_proxy.lower())

    def test_public_proxy_response_boundary_is_fail_closed(self):
        adapter = self.contract["vercel_adapter"]
        self.assertTrue(adapter["set_cookie_validation_required"])
        self.assertEqual(
            adapter["set_cookie_allowed_names"],
            [
                "ordax_access",
                "ordax_refresh",
                "ordax_recovery",
                "ordax_recovery_access",
                "ordax_recovery_refresh",
            ],
        )
        self.assertFalse(adapter["set_cookie_domain_attribute_allowed"])
        self.assertTrue(adapter["set_cookie_secure_required"])
        self.assertTrue(adapter["set_cookie_http_only_required"])
        self.assertEqual(adapter["set_cookie_same_site"], "Lax")
        self.assertFalse(adapter["upstream_absolute_redirect_allowed"])
        self.assertFalse(adapter["upstream_protocol_relative_redirect_allowed"])
        self.assertIn("trustedSetCookie", self.vercel_proxy)
        self.assertIn("normalizeUpstreamLocation", self.vercel_proxy)
        self.assertIn("unsafe-account-gateway-response", self.vercel_proxy)

    def test_oidc_identity_is_short_lived_runtime_authority_not_browser_authority(self):
        adapter = self.contract["vercel_adapter"]
        edge = self.contract["public_edge_gateway"]
        self.assertEqual(adapter["oidc_runtime_environment_variable"], "VERCEL_OIDC_TOKEN")
        self.assertEqual(adapter["oidc_runtime_resolver"], "@vercel/oidc.getVercelOidcToken")
        self.assertFalse(adapter["proxy_direct_oidc_environment_read_allowed"])
        self.assertTrue(adapter["oidc_generation_enabled"])
        self.assertEqual(adapter["oidc_issuer_mode"], "team")
        self.assertFalse(adapter["browser_authorization_forwarded"])
        self.assertTrue(adapter["runtime_oidc_replaces_browser_authorization"])
        self.assertFalse(adapter["shared_proxy_secret_required"])
        self.assertEqual(edge["oidc_issuer"], "https://oidc.vercel.com/jogo-brasils-projects")
        self.assertEqual(edge["oidc_audience"], "https://vercel.com/jogo-brasils-projects")
        self.assertEqual(
            edge["oidc_subject"],
            "owner:jogo-brasils-projects:project:ordax-os-public:environment:production",
        )
        self.assertFalse(edge["oidc_authorization_forwarded_to_inner_gateway"])

    def test_canonical_origin_and_browser_mutation_context_are_mandatory(self):
        adapter = self.contract["vercel_adapter"]
        requirements = self.contract["production_requirements"]
        self.assertEqual(adapter["canonical_public_origin_environment_variable"], "ORDAX_PUBLIC_ORIGIN")
        self.assertTrue(adapter["canonical_public_origin_required"])
        self.assertFalse(adapter["canonical_public_origin_live_configured"])
        self.assertFalse(adapter["canonical_public_origin_deployment_verified"])
        self.assertEqual(adapter["canonical_public_origin"], "https://ordax.com.br")
        self.assertEqual(adapter["team"], "ordaxsystems")
        self.assertEqual(adapter["gateway_upstream_environment_scope"], ["production"])
        self.assertFalse(adapter["legacy_shared_secret_production_or_preview_exposed"])
        self.assertTrue(adapter["incoming_request_origin_must_equal_canonical_origin"])
        self.assertFalse(adapter["browser_host_header_trusted"])
        self.assertTrue(adapter["trusted_forwarded_host_derived_from_canonical_origin"])
        self.assertTrue(adapter["state_change_exact_browser_origin_required"])
        self.assertTrue(adapter["state_change_sec_fetch_site_same_origin_required"])
        self.assertTrue(adapter["state_change_missing_origin_fails_closed"])
        self.assertTrue(requirements["public_proxy_must_bind_to_canonical_origin"])
        self.assertTrue(requirements["public_state_changes_must_require_exact_origin_and_fetch_metadata"])
        self.assertTrue(requirements["public_proxy_must_reject_untrusted_upstream_redirects_and_cookies"])

    def test_vercel_adapter_is_fail_closed_until_real_rollout_gates_are_proven(self):
        adapter = self.contract["vercel_adapter"]
        edge = self.contract["public_edge_gateway"]
        self.assertFalse(adapter["public_auth_rate_limit_deployed"])
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])
        self.assertFalse(self.contract["routing"]["vercel_adapter_routed_to_public_edge_gateway"])
        self.assertTrue(edge["deployed"])
        self.assertTrue(edge["oidc_source_ready"])
        self.assertTrue(edge["oidc_deployed"])
        self.assertFalse(edge["runtime_provenance_e2e_verified"])

    def test_deployment_proof_is_credential_free_and_checks_real_same_origin_routes(self):
        text = DEPLOYMENT_PROOF.read_text(encoding="utf-8")
        self.assertIn("PUBLIC_SITE_DEPLOYMENT_PROOF=PASS", text)
        self.assertIn('"/auth/session"', text)
        self.assertIn('"/sync/snapshot?limit=1"', text)
        self.assertIn("authentication-required", text)
        self.assertIn("public-account-access-disabled", text)
        for forbidden in (
            "ORDAX_PROOF_ACCOUNT_PASSWORD",
            "service_role",
            "SUPABASE_SERVICE_ROLE_KEY",
        ):
            self.assertNotIn(forbidden, text)

    def test_public_activation_requires_production_oidc_and_legal_hardening(self):
        requirements = self.contract["production_requirements"]
        self.assertTrue(requirements["https"])
        self.assertTrue(requirements["final_legal_documents_required_before_identity_activation"])
        self.assertTrue(requirements["leaked_password_protection_required_before_identity_activation"])
        self.assertTrue(requirements["public_proxy_must_be_authenticated_before_trusting_forwarded_client_ip"])
        self.assertTrue(requirements["public_proxy_vercel_production_oidc_required"])
        self.assertTrue(requirements["preview_oidc_must_not_access_production_account_boundary"])
        self.assertTrue(requirements["public_auth_rate_limits_required"])


if __name__ == "__main__":
    unittest.main()
