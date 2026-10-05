import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"
NGINX = ROOT / "deploy" / "public-site" / "nginx.conf"
VERCEL = ROOT / "vercel.json"
VERCEL_PROXY = ROOT / "api" / "account-proxy.mjs"
DEPLOYMENT_PROOF = ROOT / "tools" / "public-site" / "prove_deployment.py"


class PublicSiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.nginx = NGINX.read_text(encoding="utf-8")
        self.vercel = json.loads(VERCEL.read_text(encoding="utf-8"))
        self.vercel_proxy = VERCEL_PROXY.read_text(encoding="utf-8")

    def test_contract_records_live_oidc_v2_without_claiming_vercel_rollout(self):
        self.assertEqual(
            self.contract["status"],
            "public-edge-oidc-v2-live-vercel-routing-proof-pending",
        )
        self.assertEqual(self.contract["vercel_adapter"]["status"], "oidc-project-configured-not-deployed")
        edge = self.contract["public_edge_gateway"]
        self.assertTrue(edge["deployed"])
        self.assertEqual(edge["deployed_version"], 2)
        self.assertEqual(edge["deployed_authentication"], "vercel-production-oidc-v2")
        self.assertEqual(edge["source_authentication"], "vercel-production-oidc-v2")
        self.assertTrue(edge["oidc_source_ready"])
        self.assertTrue(edge["oidc_deployed"])
        self.assertFalse(edge["runtime_provenance_e2e_verified"])
        self.assertFalse(edge["oidc_preview_allowed"])
        self.assertTrue(self.contract["routing"]["public_edge_gateway_deployed"])
        self.assertFalse(self.contract["routing"]["vercel_adapter_routed_to_public_edge_gateway"])

    def test_adapter_is_loopback_only_and_routes_only_account_prefixes_to_gateway(self):
        self.assertIn("listen 127.0.0.1:8080;", self.nginx)
        self.assertIn("location ~ ^/(auth|sync)/", self.nginx)
        self.assertIn("/functions/v1/ordax-account-gateway$1", self.nginx)
        self.assertNotIn("listen 0.0.0.0", self.nginx)
        self.assertNotIn("service_role", self.nginx.lower())
        self.assertIn("proxy_set_header X-OrdaX-Public-Site 1;", self.nginx)
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])

    def test_host_neutral_adapter_keeps_rate_limits_as_defense_in_depth(self):
        self.assertIn("ordax_auth_credentials:10m rate=10r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_request:10m rate=3r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_completion:10m rate=10r/m", self.nginx)
        self.assertIn("limit_req_status 429;", self.nginx)
        self.assertFalse(self.contract["adapter"]["public_auth_rate_limit_deployed"])
        self.assertTrue(self.contract["security_rate_limits"]["authoritative_backend"]["deployed"])

    def test_vercel_routes_only_auth_and_sync_through_bounded_server_function(self):
        self.assertEqual(self.vercel["outputDirectory"], "sites/public")
        rewrites = {item["source"]: item["destination"] for item in self.vercel["rewrites"]}
        self.assertEqual(rewrites["/auth/:path*"], "/api/account-proxy?ordax_path=/auth/:path*")
        self.assertEqual(rewrites["/sync/:path*"], "/api/account-proxy?ordax_path=/sync/:path*")
        self.assertIn('const MAX_BODY_BYTES = 64 * 1024;', self.vercel_proxy)
        self.assertIn('const ALLOWED_PREFIXES = ["/auth/", "/sync/"];', self.vercel_proxy)
        self.assertIn('process.env.VERCEL_OIDC_TOKEN', self.vercel_proxy)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.vercel_proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.vercel_proxy)
        self.assertIn('/functions/v1/ordax-public-account-gateway', self.vercel_proxy)
        self.assertNotIn('ORDAX_PUBLIC_PROXY_SECRET', self.vercel_proxy)
        self.assertNotIn('x-ordax-public-proxy-secret', self.vercel_proxy)
        self.assertNotIn("service_role", self.vercel_proxy.lower())

    def test_oidc_identity_is_short_lived_runtime_authority_not_browser_authority(self):
        adapter = self.contract["vercel_adapter"]
        edge = self.contract["public_edge_gateway"]
        self.assertEqual(adapter["oidc_runtime_environment_variable"], "VERCEL_OIDC_TOKEN")
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
