import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "index.ts"
RATE_LIMIT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_auth_rate_limit.mjs"
REQUEST_CONTEXT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_request_context.mjs"
OIDC_REEXPORT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "vercel_oidc.mjs"
OIDC = ROOT / "infra" / "supabase" / "functions" / "_shared" / "vercel_public_proxy_identity.mjs"
INNER_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
VERCEL_PROXY = ROOT / "api" / "account-proxy.mjs"


class PublicAccountEdgeGatewaySourceTests(unittest.TestCase):
    def setUp(self):
        self.edge = PUBLIC_EDGE.read_text(encoding="utf-8")
        self.rate_limit = RATE_LIMIT.read_text(encoding="utf-8")
        self.request_context = REQUEST_CONTEXT.read_text(encoding="utf-8")
        self.oidc_reexport = OIDC_REEXPORT.read_text(encoding="utf-8")
        self.oidc = OIDC.read_text(encoding="utf-8")
        self.inner = INNER_EDGE.read_text(encoding="utf-8")
        self.proxy = VERCEL_PROXY.read_text(encoding="utf-8")

    def test_public_boundary_requires_identity_context_address_and_rate_limit_before_forward(self):
        self.assertIn("verifyPublicProxyIdentity(req)", self.edge)
        self.assertIn('identity.source !== "vercel-production-oidc"', self.edge)
        self.assertIn('"public-proxy-authentication-required"', self.edge)
        self.assertIn("verifyTrustedPublicRequestContext(req)", self.edge)
        self.assertIn('"public-request-context-rejected"', self.edge)
        auth_index = self.edge.index("verifyPublicProxyIdentity(req)")
        context_index = self.edge.index("verifyTrustedPublicRequestContext(req)")
        address_index = self.edge.index("trustedPublicClientAddress(req)")
        rpc_index = self.edge.index('rpc("ordax_consume_public_auth_rate_limit_v1"')
        forward_index = self.edge.index("fetch(innerTarget")
        self.assertLess(auth_index, context_index)
        self.assertLess(context_index, address_index)
        self.assertLess(address_index, rpc_index)
        self.assertLess(rpc_index, forward_index)

    def test_request_context_is_exact_origin_and_fail_closed_for_mutations(self):
        self.assertIn('STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])', self.request_context)
        self.assertIn('fetchSite !== "same-origin"', self.request_context)
        self.assertIn('fail("browser-origin-required")', self.request_context)
        self.assertIn('fail("browser-origin-mismatch")', self.request_context)
        self.assertIn('fail("trusted-forwarded-authority-mismatch")', self.request_context)
        self.assertIn('url.protocol !== "https:"', self.request_context)

    def test_oidc_is_scoped_to_team_project_and_production_environment(self):
        self.assertIn('https://oidc.vercel.com/jogo-brasils-projects', self.oidc)
        self.assertIn('https://vercel.com/jogo-brasils-projects', self.oidc)
        self.assertIn(
            'owner:jogo-brasils-projects:project:ordax-os-public:environment:production',
            self.oidc,
        )
        self.assertIn('npm:jose@6.2.12', self.oidc)
        self.assertIn('new URL("/.well-known/jwks", VERCEL_OIDC_ISSUER)', self.oidc)
        self.assertIn('algorithms: ["RS256", "ES256"]', self.oidc)
        self.assertNotIn('environment:preview', self.oidc)
        self.assertIn('../_shared/vercel_public_proxy_identity.mjs', self.oidc_reexport)

    def test_runtime_oidc_is_verified_then_forwarded_only_as_inner_boundary_identity(self):
        request_headers_start = self.edge.index("const REQUEST_HEADERS")
        request_headers_end = self.edge.index("];", request_headers_start)
        request_headers = self.edge[request_headers_start:request_headers_end]
        self.assertNotIn("x-ordax-client-address", request_headers)
        self.assertNotIn("x-ordax-public-origin", request_headers)
        self.assertNotIn("authorization", request_headers.lower())
        self.assertIn('headers.set("x-ordax-public-site", "1")', self.edge)
        self.assertIn('headers.set("apikey", publishableKey)', self.edge)
        self.assertIn('headers.set("authorization", verifiedAuthorization)', self.edge)
        self.assertIn('req.headers.get("authorization") ?? ""', self.edge)
        verify_index = self.edge.index("verifyPublicProxyIdentity(req)")
        forward_index = self.edge.index('headers.set("authorization", verifiedAuthorization)')
        self.assertLess(verify_index, forward_index)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-origin", trustedPublicOrigin)', self.proxy)
        self.assertNotIn("x-ordax-public-proxy-secret", self.proxy)

    def test_auth_rate_limit_runs_before_inner_account_gateway(self):
        self.assertIn('ordax_consume_public_auth_rate_limit_v1', self.edge)
        self.assertIn('return "credentials"', self.edge)
        self.assertIn('return "recovery-request"', self.edge)
        self.assertIn('return "recovery-completion"', self.edge)
        self.assertIn('"auth-rate-limit-unavailable"', self.edge)
        self.assertIn('"auth-rate-limited"', self.edge)
        self.assertIn('"retry-after"', self.edge)
        self.assertIn('trustedPublicClientAddress', self.rate_limit)

    def test_public_boundary_is_narrow_and_bounded(self):
        self.assertIn('const MAX_BODY = 64 * 1024', self.edge)
        self.assertIn('const MAX_UPSTREAM_RESPONSE = 2 * 1024 * 1024', self.edge)
        self.assertIn('const ALLOWED_METHODS = new Set(["GET", "POST"])', self.edge)
        self.assertIn('const ALLOWED_PREFIXES = ["/auth/", "/account/", "/sync/", "/network/"]', self.edge)

    def test_proxy_targets_only_the_public_boundary_and_uses_runtime_oidc(self):
        self.assertIn(
            'const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway"',
            self.proxy,
        )
        self.assertIn("url.pathname !== PUBLIC_GATEWAY_PATH", self.proxy)
        self.assertIn('import("@vercel/oidc")', self.proxy)
        self.assertIn("runtime.getVercelOidcToken", self.proxy)
        self.assertIn("resolveVercelOidcToken", self.proxy)
        self.assertNotIn("process.env.VERCEL_OIDC_TOKEN", self.proxy)
        self.assertIn("process.env.ORDAX_PUBLIC_ORIGIN", self.proxy)
        self.assertNotIn("ORDAX_PUBLIC_PROXY_SECRET", self.proxy)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.proxy)
        self.assertIn('headers.set("x-forwarded-host", canonical.host)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-origin", trustedPublicOrigin)', self.proxy)

    def test_inner_gateway_reverifies_trusted_identity_and_remains_fail_closed_during_rollout(self):
        self.assertIn('verifyPublicProxyIdentity', self.inner)
        self.assertIn('trustedBoundaryRequired(path)', self.inner)
        self.assertIn('path.startsWith("/auth/")', self.inner)
        self.assertIn('path.startsWith("/account/")', self.inner)
        self.assertIn('path.startsWith("/sync/")', self.inner)
        self.assertIn('path.startsWith("/network/")', self.inner)
        self.assertIn('"trusted-account-boundary-required"', self.inner)
        identity_index = self.inner.index("verifyPublicProxyIdentity(req)")
        csrf_index = self.inner.index("crossSiteStateChange(req)")
        self.assertLess(identity_index, csrf_index)
        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", self.inner)
        self.assertIn('"public-account-access-disabled"', self.inner)


if __name__ == "__main__":
    unittest.main()
