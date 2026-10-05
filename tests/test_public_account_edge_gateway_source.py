import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "index.ts"
PROVENANCE = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_auth_rate_limit.mjs"
INNER_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
VERCEL_PROXY = ROOT / "api" / "account-proxy.mjs"


class PublicAccountEdgeGatewaySourceTests(unittest.TestCase):
    def setUp(self):
        self.edge = PUBLIC_EDGE.read_text(encoding="utf-8")
        self.provenance = PROVENANCE.read_text(encoding="utf-8")
        self.inner = INNER_EDGE.read_text(encoding="utf-8")
        self.proxy = VERCEL_PROXY.read_text(encoding="utf-8")

    def test_public_boundary_requires_authenticated_proxy_before_forward(self):
        self.assertIn("trustedRateLimitAddress(req)", self.edge)
        self.assertIn('provenance.source !== "authenticated-public-proxy"', self.edge)
        self.assertIn('"public-proxy-authentication-required"', self.edge)
        auth_index = self.edge.index("trustedRateLimitAddress(req)")
        forward_index = self.edge.index("fetch(innerTarget")
        self.assertLess(auth_index, forward_index)

    def test_sensitive_proxy_headers_are_consumed_not_forwarded(self):
        request_headers_start = self.edge.index("const REQUEST_HEADERS")
        request_headers_end = self.edge.index("];", request_headers_start)
        request_headers = self.edge[request_headers_start:request_headers_end]
        self.assertNotIn("x-ordax-public-proxy-secret", request_headers)
        self.assertNotIn("x-ordax-client-address", request_headers)
        self.assertNotIn("authorization", request_headers.lower())
        self.assertIn('headers.set("x-ordax-public-site", "1")', self.edge)
        self.assertIn('headers.set("apikey", publishableKey)', self.edge)

    def test_auth_rate_limit_runs_before_inner_account_gateway(self):
        self.assertIn('ordax_consume_public_auth_rate_limit_v1', self.edge)
        self.assertIn('return "credentials"', self.edge)
        self.assertIn('return "recovery-request"', self.edge)
        self.assertIn('return "recovery-completion"', self.edge)
        self.assertIn('"auth-rate-limit-unavailable"', self.edge)
        self.assertIn('"auth-rate-limited"', self.edge)
        self.assertIn('"retry-after"', self.edge)
        rpc_index = self.edge.index('rpc("ordax_consume_public_auth_rate_limit_v1"')
        forward_index = self.edge.index("fetch(innerTarget")
        self.assertLess(rpc_index, forward_index)

    def test_public_boundary_is_narrow_and_bounded(self):
        self.assertIn('const MAX_BODY = 64 * 1024', self.edge)
        self.assertIn('const MAX_UPSTREAM_RESPONSE = 2 * 1024 * 1024', self.edge)
        self.assertIn('const ALLOWED_METHODS = new Set(["GET", "POST"])', self.edge)
        self.assertIn('const ALLOWED_PREFIXES = ["/auth/", "/sync/"]', self.edge)
        self.assertNotIn('/account/', self.edge)
        self.assertNotIn('/network/', self.edge)

    def test_proxy_targets_only_the_authenticated_public_boundary(self):
        self.assertIn(
            'const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway"',
            self.proxy,
        )
        self.assertIn("url.pathname !== PUBLIC_GATEWAY_PATH", self.proxy)
        self.assertIn('headers.set("x-ordax-public-proxy-secret", trustedProxySecret)', self.proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.proxy)

    def test_provenance_uses_environment_digest_only_and_native_edge_fallback_is_not_accepted_by_public_wrapper(self):
        self.assertIn('ORDAX_PUBLIC_PROXY_SECRET_SHA256', self.provenance)
        self.assertIn('runtimeProxySecretSha256()', self.provenance)
        self.assertIn('normalizeProxySecretSha256', self.provenance)
        self.assertIn('"cf-connecting-ip"', self.provenance)
        self.assertIn('source: "authenticated-public-proxy"', self.provenance)
        self.assertIn('source: "supabase-edge"', self.provenance)
        self.assertNotIn('const PUBLIC_PROXY_SECRET_SHA256 = "', self.provenance)
        self.assertNotIn("ORDAX_PUBLIC_PROXY_SECRET\"", self.provenance)
        self.assertIn('provenance.source !== "authenticated-public-proxy"', self.edge)

    def test_inner_gateway_remains_fail_closed_during_boundary_rollout(self):
        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", self.inner)
        self.assertIn('"public-account-access-disabled"', self.inner)


if __name__ == "__main__":
    unittest.main()
