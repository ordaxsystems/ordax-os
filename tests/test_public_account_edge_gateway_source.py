"""Source-boundary checks for the public Account transport.

The Vercel API entrypoint is intentionally a thin wrapper. Security assertions
belong to the canonical implementation in lib/account-proxy-core.mjs, not to a
copy of that implementation under api/.
"""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "index.ts"
RATE_LIMIT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_auth_rate_limit.mjs"
RATE_LIMIT_POLICY = ROOT / "infra" / "supabase" / "functions" / "_shared" / "auth_rate_limit.mjs"
REQUEST_CONTEXT = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "public_request_context.mjs"
OIDC = ROOT / "infra" / "supabase" / "functions" / "ordax-public-account-gateway" / "vercel_oidc.mjs"
INNER_EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
TRANSPORT = ROOT / "infra" / "supabase" / "functions" / "_shared" / "account_transport_admission.mjs"
BRIDGE = ROOT / "infra" / "supabase" / "functions" / "_shared" / "account_service_bridge.mjs"
COOKIE_POLICY = ROOT / "infra" / "supabase" / "functions" / "_shared" / "account_cookie_policy.mjs"
VERCEL_ENTRY = ROOT / "api" / "account-proxy.mjs"
VERCEL_PROXY_CORE = ROOT / "lib" / "account-proxy-core.mjs"


class PublicAccountEdgeGatewaySourceTests(unittest.TestCase):
    def setUp(self):
        self.edge = PUBLIC_EDGE.read_text(encoding="utf-8")
        self.rate_limit = RATE_LIMIT.read_text(encoding="utf-8")
        self.rate_limit_policy = RATE_LIMIT_POLICY.read_text(encoding="utf-8")
        self.request_context = REQUEST_CONTEXT.read_text(encoding="utf-8")
        self.oidc = OIDC.read_text(encoding="utf-8")
        self.inner = INNER_EDGE.read_text(encoding="utf-8")
        self.transport = TRANSPORT.read_text(encoding="utf-8")
        self.bridge = BRIDGE.read_text(encoding="utf-8")
        self.cookie_policy = COOKIE_POLICY.read_text(encoding="utf-8")
        self.entry = VERCEL_ENTRY.read_text(encoding="utf-8")
        self.proxy = VERCEL_PROXY_CORE.read_text(encoding="utf-8")

    def test_vercel_entry_is_thin_and_security_logic_has_one_owner(self):
        self.assertEqual(
            self.entry,
            'export * from "../lib/account-proxy-core.mjs";\n'
            'export { default } from "../lib/account-proxy-core.mjs";\n',
        )
        self.assertIn('const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway"', self.proxy)
        self.assertIn('import { readBoundedBody }', self.proxy)
        self.assertIn('import { isPublicBridgeRoute }', self.proxy)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", self.proxy)

    def test_public_and_internal_gateways_share_exact_route_policy(self):
        self.assertIn("export function stripEdgeFunctionPrefix(", self.transport)
        self.assertIn('pathname.startsWith(prefix + "/")', self.transport)
        self.assertIn("export function isPublicBridgeRoute(method, pathname)", self.transport)
        for route, method in (
            ("/account/export", "GET"),
            ("/account/spaces", "GET"),
            ("/account/entitlements/memory-cloud", "GET"),
            ("/account/close", "POST"),
        ):
            self.assertIn(f'["{route}", "{method}"]', self.transport)
        self.assertIn('stripEdgeFunctionPrefix(url.pathname, "ordax-public-account-gateway")', self.edge)
        self.assertIn('accountGatewayRoutePath(url.pathname)', self.inner)
        self.assertIn('isPublicBridgeRoute(method, parsed.pathname)', self.proxy)
        self.assertNotIn('/network/', self.edge)

    def test_oidc_is_production_scoped_and_consumed_at_public_boundary(self):
        self.assertIn('https://oidc.vercel.com/ordaxsystems', self.oidc)
        self.assertIn('https://vercel.com/ordaxsystems', self.oidc)
        self.assertIn(
            'owner:ordaxsystems:project:ordax-os-public:environment:production',
            self.oidc,
        )
        self.assertNotIn('environment:preview', self.oidc)
        self.assertNotIn('jogo-brasils-projects', self.oidc)
        self.assertIn('import("@vercel/oidc")', self.proxy)
        self.assertIn("runtime.getVercelOidcToken", self.proxy)
        self.assertNotIn("process.env.VERCEL_OIDC_TOKEN", self.proxy)
        self.assertIn('headers.set("authorization", `Bearer ${trustedOidcToken}`)', self.proxy)
        self.assertIn('headers.set("x-ordax-client-address", realIp)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-origin", trustedPublicOrigin)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-host", canonical.host)', self.proxy)
        self.assertIn('headers.set("x-ordax-public-proto", "https")', self.proxy)
        self.assertNotIn("x-ordax-public-proxy-secret", self.proxy)

    def test_browser_origin_and_forwarded_authority_fail_closed(self):
        self.assertIn('STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])', self.request_context)
        self.assertIn('fetchSite !== "same-origin"', self.request_context)
        self.assertIn('fail("browser-origin-required")', self.request_context)
        self.assertIn('fail("browser-origin-mismatch")', self.request_context)
        self.assertIn('fail("trusted-public-authority-mismatch")', self.request_context)
        self.assertIn('url.protocol !== "https:"', self.request_context)
        self.assertIn("process.env.ORDAX_PUBLIC_ORIGIN", self.proxy)
        self.assertIn('headers.set("x-forwarded-host", canonical.host)', self.proxy)

    def test_named_service_bridge_is_single_owned_and_never_user_authority(self):
        self.assertIn('ACCOUNT_BRIDGE_KEY_NAME = "ordax_account_public_bridge"', self.bridge)
        self.assertIn("sb_secret_", self.bridge)
        self.assertIn("Object.prototype.hasOwnProperty.call", self.bridge)
        self.assertIn('headers?.get?.("apikey")', self.bridge)
        self.assertIn('headers?.get?.("x-ordax-public-site")', self.bridge)
        self.assertIn("constantTimeEqual", self.bridge)
        self.assertNotIn('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""', self.bridge)
        self.assertIn('accountBridgeSecret(Deno.env.get("SUPABASE_SECRET_KEYS")', self.edge)
        self.assertIn('headers.set("apikey", serverSecret)', self.edge)
        self.assertIn("headers: upstreamHeaders(req, bridgeKey)", self.edge)
        self.assertNotIn('headers.set("authorization",', self.edge)

    def test_transport_admission_precedes_privileged_handlers(self):
        self.assertIn("const transport = await authorizeAccountTransport(req, path, {", self.inner)
        self.assertIn("verifyNativeSession: async () => {", self.inner)
        self.assertIn("supabase.auth.getUser(access)", self.inner)
        self.assertIn('"public-account-boundary-authentication-required"', self.inner)
        transport_index = self.inner.index("authorizeAccountTransport(req, path")
        handler_markers = [
            marker for marker in (
                'if (method === "GET" && path === "/account/spaces")',
                'if (method === "GET" && path === "/account/export")',
                'if (method === "POST" && path === "/account/close")',
            )
            if marker in self.inner
        ]
        self.assertTrue(handler_markers)
        for marker in handler_markers:
            self.assertLess(transport_index, self.inner.index(marker))

    def test_rate_limits_and_request_body_limits_are_server_authoritative(self):
        self.assertIn('ordax_consume_public_auth_rate_limit_v1', self.edge)
        self.assertIn('return "credentials"', self.rate_limit_policy)
        self.assertIn('return "recovery-request"', self.rate_limit_policy)
        self.assertIn('return "recovery-completion"', self.rate_limit_policy)
        self.assertIn('trustedPublicClientAddress', self.rate_limit)
        self.assertIn('"auth-rate-limit-unavailable"', self.edge)
        self.assertIn('"auth-rate-limited"', self.edge)
        self.assertIn('readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY)', self.edge)
        self.assertIn('readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY)', self.inner)
        self.assertNotIn("await req.arrayBuffer()", self.edge)
        self.assertNotIn("await req.arrayBuffer()", self.inner)

    def test_external_security_responses_are_bounded_before_decode(self):
        self.assertIn('readBoundedBody(', self.proxy)
        self.assertIn('response.body,', self.proxy)
        self.assertIn('MAX_TURNSTILE_RESPONSE_BYTES,', self.proxy)
        self.assertIn('new TextDecoder("utf-8", { fatal: true })', self.proxy)
        self.assertNotIn("await response.text()", self.proxy)
        self.assertIn('PWNED_PASSWORDS_MAX_RESPONSE,', self.inner)
        self.assertIn('signal: AbortSignal.timeout(5_000)', self.inner)
        self.assertIn('new TextDecoder("utf-8", { fatal: true })', self.inner)
        self.assertNotIn("await response.text()", self.inner)

    def test_product_cookies_use_authenticated_private_envelope(self):
        self.assertIn('const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope"', self.edge)
        self.assertIn('headers.set(COOKIE_ENVELOPE_HEADER, JSON.stringify(cookies))', self.edge)
        self.assertNotIn('headers.append("set-cookie"', self.edge)
        self.assertIn('const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope"', self.proxy)
        self.assertIn("trustedCookieEnvelope", self.proxy)
        self.assertIn("upstream.headers.get(COOKIE_ENVELOPE_HEADER)", self.proxy)
        self.assertNotIn("upstream.headers.getSetCookie", self.proxy)
        self.assertNotIn('upstream.headers.get("set-cookie")', self.proxy)
        self.assertIn("export function productCookiesFromUpstream(rawValues)", self.cookie_policy)
        self.assertIn("return trustedCookieEnvelope(JSON.stringify(product))", self.cookie_policy)

    def test_public_proxy_is_narrow_bounded_and_targets_only_public_edge(self):
        self.assertIn('const MAX_BODY_BYTES = 64 * 1024', self.proxy)
        self.assertIn('const ALLOWED_METHODS = new Set(["GET", "POST"])', self.proxy)
        self.assertIn('url.pathname !== PUBLIC_GATEWAY_PATH', self.proxy)
        self.assertIn('isPublicBridgeRoute(method, parsed.pathname)', self.proxy)
        self.assertNotIn("PUBLIC_ACCOUNT_ROUTES = new Map", self.proxy)
        self.assertNotIn("ORDAX_PUBLIC_PROXY_SECRET", self.proxy)
        self.assertIn("normalizeGatewayUrl", self.proxy)
        self.assertIn("resolveVercelOidcToken", self.proxy)


if __name__ == "__main__":
    unittest.main()
