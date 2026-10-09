from __future__ import annotations

import importlib.util
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "tools/public-site/probe_public_network.py"
SPEC = importlib.util.spec_from_file_location("ordax_public_network_proof", SOURCE)
assert SPEC is not None and SPEC.loader is not None
network = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(network)


class Response:
    def __init__(self, status=200, *, payload=None, content_type="text/html; charset=utf-8"):
        self.status = status
        self.data = json.dumps(payload).encode("utf-8") if payload is not None else b"OK"
        self.headers = {
            "Content-Type": "application/json; charset=utf-8" if payload is not None else content_type,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store, max-age=0",
            "Location": "https://ordax.com.br/",
        }

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size):
        return self.data[:size]


def fake_fetch(host, path, *, accept="text/html", ready=False, provider=None):
    if host == network.WWW_HOST:
        return Response(308)
    if path == "/config/public-site.json":
        assert accept == "application/json"
        return Response(payload={
            "$schema": "prototype-ordax.public-site-runtime/1",
            "legal": {"account_activation_ready": ready},
        })
    if path == "/auth/session":
        assert accept == "application/json"
        return Response(payload={
            "$schema": "prototype-ordax.public-identity-session/1",
            "authenticated": False,
            "status": "anonymous",
            "provider": provider or ("supabase" if ready else "gated"),
        })
    return Response()


class PublicNetworkProofTests(unittest.TestCase):
    def test_probe_accepts_only_canonical_vetted_hosts(self):
        self.assertEqual(network.CANONICAL_HOST, "ordax.com.br")
        self.assertEqual(network.WWW_HOST, "www.ordax.com.br")
        self.assertEqual(network.CANONICAL_VERCEL_IPV4, "76.76.21.21")
        self.assertEqual(network.PATHS, ("/", "/login/", "/cadastro/", "/privacidade/", "/termos/"))
        self.assertIsNone(
            network.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.invalid")
        )

    def test_success_proves_pages_anonymous_session_and_www_redirect(self):
        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=fake_fetch),
        ):
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(network.main(), 0)
            self.assertIn("ORDAX_PUBLIC_ACCOUNT_GATE=gated", stream.getvalue())
            self.assertIn("ORDAX_PUBLIC_SESSION_STATUS=200", stream.getvalue())
            self.assertIn("ORDAX_PUBLIC_NETWORK_PROOF=PASS", stream.getvalue())

    def test_future_active_identity_must_report_supabase_anonymous(self):
        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=lambda h, p, *, accept="text/html":
                         fake_fetch(h, p, accept=accept, ready=True)),
        ):
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(network.main(), 0)
            self.assertIn("ORDAX_PUBLIC_ACCOUNT_GATE=supabase", stream.getvalue())

    def test_cloudflare_proxy_address_cannot_count_as_direct_vercel(self):
        with patch.object(network, "resolve_v4", return_value={"104.21.40.1"}):
            with self.assertRaisesRegex(SystemExit, "dns-apex-not-direct-vercel"):
                network.main()

    def test_failed_static_page_does_not_count_as_uptime(self):
        def failing(host, path, *, accept="text/html"):
            return Response(503) if path == "/login/" else fake_fetch(host, path, accept=accept)

        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=failing),
        ):
            with self.assertRaisesRegex(SystemExit, "unexpected-page-status:/login/"):
                network.main()

    def test_public_session_provider_must_match_legal_activation(self):
        for ready, wrong_provider in ((False, "supabase"), (True, "gated")):
            with self.subTest(ready=ready):
                with (
                    patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
                    patch.object(network, "fetch", side_effect=lambda h, p, *, accept="text/html":
                                 fake_fetch(h, p, accept=accept, ready=ready, provider=wrong_provider)),
                ):
                    with self.assertRaisesRegex(SystemExit, "public-session-provider-gate-mismatch"):
                        network.main()

    def test_json_endpoint_must_not_serve_html_or_cache_session(self):
        for header, value, expected in (
            ("Content-Type", "text/html", "json-content-type:/auth/session"),
            ("Cache-Control", "public, max-age=3600", "json-no-store:/auth/session"),
        ):
            with self.subTest(header=header):
                def fake_bad(host, path, *, accept="text/html"):
                    result = fake_fetch(host, path, accept=accept)
                    if path == "/auth/session":
                        result.headers[header] = value
                    return result

                with (
                    patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
                    patch.object(network, "fetch", side_effect=fake_bad),
                ):
                    with self.assertRaisesRegex(SystemExit, expected):
                        network.main()

    def test_current_unconfigured_account_gateway_is_reported_as_disabled(self):
        def disabled(host, path, *, accept="text/html"):
            if path == "/auth/session":
                return Response(503, payload={
                    "$schema": "prototype-ordax.public-site-proxy-error/1",
                    "error": "account-gateway-unconfigured",
                })
            return fake_fetch(host, path, accept=accept)

        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=disabled),
        ):
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(network.main(), 0)
            self.assertIn("ORDAX_PUBLIC_SESSION_STATUS=503", stream.getvalue())
            self.assertIn("ORDAX_PUBLIC_ACCOUNT_GATE=disabled-unconfigured", stream.getvalue())
            self.assertIn("ORDAX_PUBLIC_NETWORK_PROOF=PASS", stream.getvalue())

    def test_activated_accounts_never_accept_unconfigured_gateway_as_healthy(self):
        def disabled(host, path, *, accept="text/html"):
            if path == "/auth/session":
                return Response(503, payload={
                    "$schema": "prototype-ordax.public-site-proxy-error/1",
                    "error": "account-gateway-unconfigured",
                })
            return fake_fetch(host, path, accept=accept, ready=True)

        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=disabled),
        ):
            with self.assertRaisesRegex(SystemExit, "active-account-session-unavailable"):
                network.main()

    def test_backend_session_outage_is_not_reported_as_static_site_success(self):
        def failing(host, path, *, accept="text/html"):
            return (
                Response(503, payload={
                    "$schema": "prototype-ordax.public-site-proxy-error/1",
                    "error": "account-gateway-unavailable",
                })
                if path == "/auth/session"
                else fake_fetch(host, path, accept=accept)
            )

        with (
            patch.object(network, "resolve_v4", return_value={"76.76.21.21"}),
            patch.object(network, "fetch", side_effect=failing),
        ):
            with self.assertRaisesRegex(SystemExit, "unexpected-account-gateway-failure"):
                network.main()


if __name__ == "__main__":
    unittest.main()
