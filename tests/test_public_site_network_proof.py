from __future__ import annotations

import importlib.util
import io
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
    headers = {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Location": "https://ordax.com.br/",
    }

    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size):
        return b"OK"[:size]


class PublicNetworkProofTests(unittest.TestCase):
    def test_probe_accepts_only_canonical_vetted_hosts(self):
        self.assertEqual(network.CANONICAL_HOST, "ordax.com.br")
        self.assertEqual(network.WWW_HOST, "www.ordax.com.br")
        self.assertEqual(network.CANONICAL_VERCEL_IPV4, "76.76.21.21")
        self.assertEqual(network.PATHS, ("/", "/login/", "/cadastro/", "/privacidade/", "/termos/"))
        self.assertIsNone(
            network.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.invalid")
        )

    def test_success_proves_https_and_www_redirect(self):
        def fetch(host, path):
            return Response(308 if host == network.WWW_HOST else 200)

        with patch.object(network, "resolve_v4", return_value={"76.76.21.21"}), \
             patch.object(network, "fetch", side_effect=fetch):
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(network.main(), 0)
            self.assertIn("ORDAX_PUBLIC_NETWORK_PROOF=PASS", stream.getvalue())

    def test_cloudflare_proxy_address_cannot_count_as_direct_vercel(self):
        with patch.object(network, "resolve_v4", return_value={"104.21.40.1"}):
            with self.assertRaisesRegex(SystemExit, "dns-apex-not-direct-vercel"):
                network.main()

    def test_proxied_or_unavailable_site_cannot_count_as_http_proof(self):
        def fetch(host, path):
            return Response(503 if path == "/login/" else 200)

        with patch.object(network, "resolve_v4", return_value={"76.76.21.21"}), \
             patch.object(network, "fetch", side_effect=fetch):
            with self.assertRaisesRegex(SystemExit, "unexpected-page-status:/login/"):
                network.main()


if __name__ == "__main__":
    unittest.main()
