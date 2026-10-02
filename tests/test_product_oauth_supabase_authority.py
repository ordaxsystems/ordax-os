#!/usr/bin/env python3
"""Tests for the server-only Supabase Product OAuth authority adapter."""

import importlib.util
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = ROOT / "services" / "product-oauth" / "supabase_authority.py"

adapter_spec = importlib.util.spec_from_file_location(
    "ordax_product_oauth_supabase_authority",
    ADAPTER_PATH,
)
adapter = importlib.util.module_from_spec(adapter_spec)
assert adapter_spec.loader is not None
sys.modules[adapter_spec.name] = adapter
adapter_spec.loader.exec_module(adapter)

USER = "11111111-1111-4111-8111-111111111111"
SPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
CLIENT = "acheguese-web-01"
REDIRECT = "https://acheguese.test/auth/ordax/callback"
GRANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class FakeTransport:
    def __init__(self):
        self.calls = []

    def call(self, name, payload):
        self.calls.append((name, payload))
        if name == "ordax_product_oauth_get_client_v1":
            return [{
                "client_id": CLIENT,
                "redirect_uris": [REDIRECT],
                "allowed_scopes": ["network.space.read"],
                "public_client": True,
                "state": "active",
                "audience": "ordax:first-party:acheguese",
            }]
        if name == "ordax_product_oauth_can_act_as_space_v1":
            return True
        if name == "ordax_product_oauth_issue_code_v1":
            return True
        if name == "ordax_product_oauth_consume_code_v1":
            return [{
                "outcome": "applied",
                "grant_id": GRANT,
                "user_id": USER,
                "client_id": CLIENT,
                "space_id": SPACE,
                "scopes": ["network.space.read"],
            }]
        if name == "ordax_product_oauth_issue_access_token_v1":
            return True
        if name == "ordax_product_oauth_resolve_access_token_v1":
            return [{
                "grant_id": GRANT,
                "user_id": USER,
                "client_id": CLIENT,
                "space_id": SPACE,
                "scopes": ["network.space.read"],
                "revoked": False,
            }]
        if name in (
            "ordax_product_oauth_revoke_access_token_v1",
            "ordax_product_oauth_revoke_grant_v1",
        ):
            return True
        raise AssertionError(name)


class ProductOAuthSupabaseAuthorityTests(unittest.TestCase):
    def test_adapter_loads_its_sibling_core_without_sys_path_mutation(self):
        self.assertEqual(
            adapter.OAuthClient.__module__,
            "ordax_product_oauth_core",
        )

    def setUp(self):
        self.transport = FakeTransport()
        values = iter(["C" * 48, "T" * 43])
        self.authority = adapter.SupabaseProductOAuthAuthority(
            adapter.SupabaseAuthorityConfig(
                base_url="https://example.supabase.co",
                secret_key="sb_secret_test_only",
                enabled=True,
            ),
            transport=self.transport,
            token_factory=lambda _n: next(values),
        )

    def test_environment_activation_is_fail_closed(self):
        with patch.dict("os.environ", {}, clear=True):
            config = adapter.SupabaseAuthorityConfig.from_environment()
        self.assertFalse(config.configured)

        self.assertFalse(
            adapter.SupabaseAuthorityConfig(
                base_url="https://example.supabase.co",
                secret_key="sb_publishable_not_server_authority",
                enabled=True,
            ).configured
        )

    def test_raw_code_and_access_token_never_enter_rpc_payload(self):
        code = self.authority.issue_authorization_code(
            user_id=USER,
            client_id=CLIENT,
            space_id=SPACE,
            scopes=("network.space.read",),
            redirect_uri=REDIRECT,
            code_challenge="A" * 43,
        )
        self.assertEqual(code, "C" * 48)
        name, payload = self.transport.calls[-1]
        self.assertEqual(name, "ordax_product_oauth_issue_code_v1")
        self.assertNotIn(code, json.dumps(payload))
        self.assertEqual(payload["p_code_hash"], adapter._sha256_hex(code))

        grant = adapter.ConsumedGrant(
            grant_id=GRANT,
            user_id=USER,
            client_id=CLIENT,
            space_id=SPACE,
            scopes=("network.space.read",),
        )
        pair = self.authority.issue_tokens(grant=grant)
        self.assertTrue(pair.access_token.startswith("ordax_access_"))
        name, payload = self.transport.calls[-1]
        self.assertEqual(name, "ordax_product_oauth_issue_access_token_v1")
        self.assertNotIn(pair.access_token, json.dumps(payload))
        self.assertEqual(
            payload["p_token_hash"],
            adapter._sha256_hex(pair.access_token),
        )
        self.assertIsNone(pair.refresh_token)

    def test_adapter_maps_persistent_rows_to_provider_neutral_types(self):
        client = self.authority.get_client(CLIENT)
        self.assertEqual(client.client_id, CLIENT)
        self.assertEqual(client.redirect_uris, (REDIRECT,))
        self.assertTrue(self.authority.can_act_as_space(user_id=USER, space_id=SPACE))

        grant = self.authority.consume_authorization_code(
            code="X" * 48,
            client_id=CLIENT,
            redirect_uri=REDIRECT,
            code_challenge="A" * 43,
        )
        self.assertEqual(grant.grant_id, GRANT)

        context = self.authority.resolve_access_token("ordax_access_" + "Y" * 32)
        self.assertEqual(context.space_id, SPACE)
        self.assertFalse(context.revoked)
        self.assertTrue(self.authority.revoke_access_token("ordax_access_" + "Y" * 32))
        self.assertTrue(self.authority.revoke_grant(GRANT))

    def test_rest_transport_uses_secret_key_only_as_apikey(self):
        config = adapter.SupabaseAuthorityConfig(
            base_url="https://example.supabase.co",
            secret_key="sb_secret_component_key",
            enabled=True,
        )
        transport = adapter.SupabaseRestRpcTransport(config)

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, _limit):
                return b"true"

        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch("urllib.request.urlopen", fake_urlopen):
            self.assertTrue(transport.call("proof_rpc", {"value": 1}))

        headers = {key.lower(): value for key, value in captured["request"].header_items()}
        self.assertEqual(headers["apikey"], "sb_secret_component_key")
        self.assertNotIn("authorization", headers)
        self.assertEqual(headers["user-agent"], "OrdaX-Product-OAuth/1")


if __name__ == "__main__":
    unittest.main()
