import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"
NGINX = ROOT / "deploy" / "public-site" / "nginx.conf"
DEPLOYMENT_PROOF = ROOT / "tools" / "public-site" / "prove_deployment.py"


class PublicSiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.nginx = NGINX.read_text(encoding="utf-8")

    def test_contract_records_host_neutral_same_origin_adapter_without_claiming_deployment(self):
        self.assertEqual(
            self.contract["status"],
            "host-neutral-same-origin-adapter-source-ready-not-deployed",
        )
        self.assertEqual(
            self.contract["adapter"]["kind"],
            "nginx-loopback-behind-https-terminator",
        )
        self.assertFalse(self.contract["adapter"]["public_listener_in_adapter_allowed"])
        self.assertFalse(self.contract["adapter"]["provider_specific_browser_api"])
        self.assertTrue(self.contract["routing"]["same_origin_identity_required"])
        self.assertTrue(self.contract["routing"]["same_origin_sync_required"])
        self.assertTrue(self.contract["routing"]["same_origin_account_required"])
        self.assertEqual(self.contract["routing"]["account_prefix"], "/account/")
        self.assertIn("/conta/", self.contract["routing"]["static_routes"])

    def test_adapter_is_loopback_only_and_routes_only_account_prefixes_to_gateway(self):
        self.assertIn("listen 127.0.0.1:8080;", self.nginx)
        self.assertIn("location ~ ^/(auth|sync|account)/", self.nginx)
        self.assertIn(
            "/functions/v1/ordax-account-gateway$1",
            self.nginx,
        )
        self.assertIn("try_files $uri $uri/index.html =404;", self.nginx)
        self.assertNotIn("listen 0.0.0.0", self.nginx)
        self.assertNotIn("service_role", self.nginx.lower())
        self.assertIn("proxy_set_header X-OrdaX-Public-Site 1;", self.nginx)
        self.assertEqual(self.contract["adapter"]["account_request_marker_header"], "X-OrdaX-Public-Site")
        self.assertEqual(self.contract["adapter"]["account_request_marker_value"], "1")
        self.assertTrue(self.contract["routing"]["gateway_public_activation_gate_required"])
        self.assertFalse(self.contract["routing"]["gateway_public_activation_currently_enabled"])

    def test_adapter_restores_real_ip_only_from_loopback_and_rate_limits_auth_abuse(self):
        self.assertIn("set_real_ip_from 127.0.0.1;", self.nginx)
        self.assertIn("set_real_ip_from ::1;", self.nginx)
        self.assertIn("real_ip_header X-Forwarded-For;", self.nginx)
        self.assertIn("real_ip_recursive on;", self.nginx)
        self.assertIn("ordax_auth_credentials:10m rate=10r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_request:10m rate=3r/m", self.nginx)
        self.assertIn("ordax_auth_recovery_completion:10m rate=10r/m", self.nginx)
        self.assertIn("ordax_account_sensitive:10m rate=5r/m", self.nginx)
        self.assertIn("limit_req_status 429;", self.nginx)
        self.assertIn("limit_req zone=ordax_auth_credentials burst=5 nodelay;", self.nginx)
        self.assertIn("limit_req zone=ordax_auth_recovery_request burst=2 nodelay;", self.nginx)
        self.assertIn("limit_req zone=ordax_auth_recovery_completion burst=5 nodelay;", self.nginx)
        self.assertIn("limit_req zone=ordax_account_sensitive burst=2 nodelay;", self.nginx)
        self.assertIn("proxy_set_header X-Forwarded-For $remote_addr;", self.nginx)
        self.assertIn("proxy_set_header X-Real-IP $remote_addr;", self.nginx)
        adapter = self.contract["adapter"]
        self.assertEqual(
            adapter["real_ip_source"],
            "trusted-loopback-tls-terminator-x-forwarded-for",
        )
        self.assertEqual(adapter["real_ip_trusted_sources"], ["127.0.0.1", "::1"])
        self.assertTrue(adapter["public_auth_rate_limit_source_ready"])
        self.assertFalse(adapter["public_auth_rate_limit_deployed"])
        self.assertEqual(self.contract["security_rate_limits"]["status_code"], 429)
        self.assertEqual(self.contract["security_rate_limits"]["account_close"]["rate"], "5r/m")

    def test_adapter_preserves_same_origin_security_and_no_store_account_routes(self):
        for name, value in self.contract["security_headers"].items():
            self.assertIn(name, self.nginx)
            self.assertIn(value, self.nginx)
        self.assertIn('~^/(auth|sync|account)/ "no-store";', self.nginx)
        self.assertIn("proxy_hide_header Access-Control-Allow-Origin;", self.nginx)
        self.assertIn("proxy_hide_header Cache-Control;", self.nginx)
        self.assertIn("proxy_set_header X-Forwarded-Proto https;", self.nginx)
        self.assertIn("proxy_set_header X-Forwarded-Host $host;", self.nginx)
        self.assertEqual(self.contract["cache_policy"]["account"], "no-store")

    def test_deployment_proof_is_credential_free_and_checks_real_same_origin_routes(self):
        text = DEPLOYMENT_PROOF.read_text(encoding="utf-8")
        self.assertIn("PUBLIC_SITE_DEPLOYMENT_PROOF=PASS", text)
        self.assertIn('"/auth/session"', text)
        self.assertIn('"/sync/snapshot?limit=1"', text)
        self.assertIn("authentication-required", text)
        self.assertIn("public-account-access-disabled", text)
        self.assertIn("public-account-gate-not-enforced", text)
        self.assertIn('"/recuperar/"', text)
        self.assertIn('"/recuperar/nova-senha/"', text)
        self.assertIn('"/auth/recover"', text)
        self.assertIn("public-recovery-gate-not-enforced", text)
        self.assertIn("origin-must-be-clean-https-origin", text)
        for forbidden in (
            "ORDAX_PROOF_ACCOUNT_PASSWORD",
            "service_role",
            "SUPABASE_SERVICE_ROLE_KEY",
        ):
            self.assertNotIn(forbidden, text)

    def test_public_activation_still_requires_auth_and_legal_hardening(self):
        requirements = self.contract["production_requirements"]
        self.assertTrue(requirements["https"])
        self.assertTrue(requirements["host_adapter_must_preserve_session_set_cookie"])
        self.assertTrue(requirements["final_legal_documents_required_before_identity_activation"])
        self.assertTrue(requirements["leaked_password_protection_required_before_identity_activation"])
        self.assertTrue(requirements["host_adapter_must_mark_public_account_requests"])
        self.assertTrue(requirements["gateway_server_side_public_activation_gate_required"])
        self.assertTrue(requirements["tls_terminator_must_append_real_client_ip"])
        self.assertTrue(requirements["adapter_must_trust_only_loopback_real_ip_source"])
        self.assertTrue(requirements["public_auth_rate_limits_required"])
        self.assertTrue(requirements["sensitive_account_mutation_rate_limit_required"])


if __name__ == "__main__":
    unittest.main()
