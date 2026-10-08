import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "index.ts"
RATE_LIMIT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_auth_rate_limit.mjs"
RATE_LIMIT_POLICY = ROOT / "infra" / "supabase" / "functions" / "_shared" / "auth_rate_limit.mjs"
REQUEST_CONTEXT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_request_context.mjs"
OIDC = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "vercel_oidc.mjs"
INNER_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
VERCEL_PROXY = ROOT / "api" / "account-proxy.mjs"


class PublicAccountEdgeGatewaySourceTests(unittest.TestCase):
    def setUp(self):
        self.edge = PUBLIC_EDGE.read_text(encoding="utf-8")
        self.rate_limit = RATE_LIMIT.read_text(encoding="utf-8")
        self.rate_limit_policy = RATE_LIMIT_POLICY.read_text(encoding="utf-8")
        self.request_context = REQUEST_CONTEXT.read_text(encoding="utf-8")
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

    def test_runtime_oidc_and_trusted_proxy_context_are_consumed_not_forwarded(self):
        request_headers_start = self.edge.index("const REQUEST_HEADERS")
        request_headers_end = self.edge.index("];", request_headers_start)
        request_headers = self.edge[request_headers_start:request_headers_end]
        self.assertNotIn("x-ordax-client-address", request_headers)
        self.assertNotIn("x-ordax-public-origin", request_headers)
        self.assertNotIn("authorization", request_headers.lower())
        self.assertIn('headers.set("x-ordax-public-site", "1")', self.edge)
        self.assertIn('headers.set("apikey", serverSecret)', self.edge)
        self.assertIn("function serverSecretKey()", self.edge)
        self.assertNotIn('headers.set("apikey", publishableKey)', self.edge)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-origin", trustedPublicOrigin)', self.proxy)
        self.assertNotIn("x-ordax-public-proxy-secret", self.proxy)

    def test_auth_rate_limit_runs_before_inner_account_gateway(self):
        self.assertIn('ordax_consume_public_auth_rate_limit_v1', self.edge)
        self.assertIn('return "credentials"', self.rate_limit_policy)
        self.assertIn('return "recovery-request"', self.rate_limit_policy)
        self.assertIn('return "recovery-completion"', self.rate_limit_policy)
        self.assertIn("authRateLimitBucket", self.edge)
        self.assertIn('"auth-rate-limit-unavailable"', self.edge)
        self.assertIn('"auth-rate-limited"', self.edge)
        self.assertIn('"retry-after"', self.edge)
        self.assertIn('trustedPublicClientAddress', self.rate_limit)

    def test_body_limits_are_checked_while_streaming_not_after_allocation(self):
        self.assertIn('import { readBoundedBody } from "../_shared/bounded_body.mjs"', self.edge)
        self.assertIn('readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY)', self.edge)
        self.assertIn('readBoundedBody(', self.edge)
        self.assertIn('upstream.body,', self.edge)
        self.assertIn('MAX_UPSTREAM_RESPONSE,', self.edge)
        self.assertNotIn("await req.arrayBuffer()", self.edge)
        self.assertNotIn("await upstream.arrayBuffer()", self.edge)
        self.assertIn('import { readBoundedBody } from "../_shared/bounded_body.mjs"', self.inner)
        self.assertIn('readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY)', self.inner)
        self.assertNotIn("await req.arrayBuffer()", self.inner)
        self.assertIn('"account-gateway-response-invalid"', self.edge)
        self.assertIn('"account-gateway-response-too-large"', self.edge)

    def test_external_security_checks_are_bounded_during_stream_read(self):
        self.assertIn('readBoundedBody(', self.proxy)
        self.assertIn('response.body,', self.proxy)
        self.assertIn('MAX_TURNSTILE_RESPONSE_BYTES,', self.proxy)
        self.assertNotIn("await response.text()", self.proxy)
        self.assertIn('new TextDecoder("utf-8", { fatal: true })', self.proxy)
        self.assertIn('PWNED_PASSWORDS_MAX_RESPONSE,', self.inner)
        self.assertIn('response.body,', self.inner)
        self.assertIn('signal: AbortSignal.timeout(5_000)', self.inner)
        self.assertIn('new TextDecoder("utf-8", { fatal: true })', self.inner)
        self.assertNotIn("await response.text()", self.inner)

    def test_public_boundary_is_narrow_and_bounded(self):
        self.assertIn('const MAX_BODY = 64 * 1024', self.edge)
        self.assertIn('const MAX_UPSTREAM_RESPONSE = 2 * 1024 * 1024', self.edge)
        self.assertIn('const ALLOWED_METHODS = new Set(["GET", "POST"])', self.edge)
        self.assertIn('const ALLOWED_PREFIXES = ["/auth/", "/sync/"]', self.edge)
        self.assertIn('const PUBLIC_ACCOUNT_ROUTES = new Map([', self.edge)
        for route, method in (
            ("/account/export", "GET"),
            ("/account/spaces", "GET"),
            ("/account/entitlements/memory-cloud", "GET"),
            ("/account/close", "POST"),
        ):
            self.assertIn(f'["{route}", "{method}"]', self.edge)
            self.assertIn(f'["{route}", "{method}"]', self.proxy)
        self.assertIn("accountMethod !== method", self.edge)
        self.assertIn("accountMethod !== method", self.proxy)
        self.assertNotIn('/network/', self.edge)

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

    def test_product_cookies_use_private_envelope_not_transport_set_cookie(self):
        self.assertIn('const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope"', self.edge)
        self.assertIn('headers.set(COOKIE_ENVELOPE_HEADER, JSON.stringify(cookies))', self.edge)
        self.assertNotIn('headers.append("set-cookie"', self.edge)
        self.assertIn('const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope"', self.proxy)
        self.assertIn("trustedCookieEnvelope", self.proxy)
        self.assertIn("upstream.headers.get(COOKIE_ENVELOPE_HEADER)", self.proxy)
        self.assertNotIn("upstream.headers.getSetCookie", self.proxy)
        self.assertNotIn('upstream.headers.get("set-cookie")', self.proxy)

    def test_inner_gateway_rejects_spoofed_public_marker_without_backend_secret(self):
        self.assertIn("function trustedPublicSiteRequest(req: Request)", self.inner)
        self.assertIn('req.headers.get("apikey")', self.inner)
        self.assertIn("expectedKey = adminConfig().key", self.inner)
        self.assertIn("constantTimeEqual(presentedKey, expectedKey)", self.inner)
        self.assertIn('"public-account-boundary-authentication-required"', self.inner)

    def test_direct_native_auth_uses_same_server_authoritative_rate_limit(self):
        self.assertIn("enforceDirectAuthRateLimit(req, path)", self.inner)
        self.assertIn('req.headers.get("cf-connecting-ip")', self.inner)
        self.assertIn("canonicalizeClientAddress", self.inner)
        self.assertIn("authRateLimitBucket(req.method, path)", self.inner)
        self.assertIn('rpc("ordax_consume_public_auth_rate_limit_v1"', self.inner)
        self.assertIn("validateRateLimitRpcResult(data, bucket)", self.inner)
        self.assertIn('"native-client-address-required"', self.inner)
        self.assertIn('"auth-rate-limit-unavailable"', self.inner)
        self.assertIn('"auth-rate-limited"', self.inner)
        self.assertIn('response.headers.set("retry-after"', self.inner)
        self.assertNotIn("user-agent", self.inner[self.inner.index("function directNativeClientAddress"):self.inner.index("function routePath")].lower())
        limiter_index = self.inner.index("enforceDirectAuthRateLimit(req, path)")
        login_index = self.inner.index('path === "/auth/login" && req.method === "POST"')
        self.assertLess(limiter_index, login_index)

    def test_inner_gateway_remains_fail_closed_during_boundary_rollout(self):
        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", self.inner)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", self.inner)
        self.assertIn('"public-account-access-disabled"', self.inner)


if __name__ == "__main__":
    unittest.main()
