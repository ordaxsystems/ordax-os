#!/usr/bin/env python3
"""Tests for the read-only first-party Product OAuth Network resource server."""

import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GATEWAY_PATH = ROOT / "services" / "product-gateway" / "oauth_network.py"
ADAPTER_PATH = ROOT / "services" / "product-gateway" / "supabase_network.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "product-network-resource.json"

gateway_spec = importlib.util.spec_from_file_location("ordax_product_network_gateway", GATEWAY_PATH)
gateway = importlib.util.module_from_spec(gateway_spec)
assert gateway_spec.loader is not None
sys.modules[gateway_spec.name] = gateway
gateway_spec.loader.exec_module(gateway)

adapter_spec = importlib.util.spec_from_file_location("ordax_product_network_supabase", ADAPTER_PATH)
adapter = importlib.util.module_from_spec(adapter_spec)
assert adapter_spec.loader is not None
sys.modules[adapter_spec.name] = adapter
adapter_spec.loader.exec_module(adapter)

TOKEN = "ordax_access_" + ("T" * 43)
SPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"


def body(response):
    return json.loads(response.body.decode("utf-8"))


class StaticOAuth:
    configured = True

    def __init__(self, scopes):
        self.scopes = tuple(scopes)
        self.calls = []

    def resolve(self, token):
        self.calls.append(token)
        if token != TOKEN:
            raise gateway._oauth.OAuthAccessDenied("invalid")
        return SimpleNamespace(
            user_id="11111111-1111-4111-8111-111111111111",
            client_id="acheguese-web-01",
            space_id=SPACE,
            scopes=self.scopes,
            revoked=False,
        )


class RecordingAuthority:
    configured = True

    def __init__(self):
        self.calls = []

    def get_space(self, token):
        self.calls.append(("space", token))
        return [{
            "space_id": SPACE,
            "public_name": "Beta Pizzaria",
            "description": "Space autorizado",
            "region_label": "BA",
            "categories": ["food", "pizzeria"],
            "visibility": "hidden",
        }]

    def list_directory(self, token, **kwargs):
        self.calls.append(("directory", token, kwargs))
        return [{
            "space_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            "public_name": "Other Company",
            "description": None,
            "region_label": "SP",
            "categories": ["food"],
        }]

    def list_communities(self, token, **kwargs):
        self.calls.append(("communities", token, kwargs))
        return [{
            "community_id": "industry.food.pizzeria.br",
            "title": "Pizzarias Brasil",
            "kind": "professional-industry",
            "jurisdiction": "BR",
            "join_policy": "explicit-consent",
        }]


class RecordingTransport:
    def __init__(self):
        self.calls = []

    def call(self, name, payload):
        self.calls.append((name, payload))
        if name == "ordax_product_network_get_space_v1":
            return []
        if name == "ordax_product_network_list_directory_v1":
            return []
        if name == "ordax_product_network_list_communities_v1":
            return []
        raise AssertionError(name)


def auth_header(token=TOKEN):
    return {"Authorization": "Bearer " + token}


class ProductNetworkResourceTests(unittest.TestCase):
    def test_default_gateway_is_read_only_fail_closed(self):
        http = gateway.ProductNetworkHttpGateway()
        status = http.handle("GET", "/product/network/v1/status")
        self.assertEqual(status.status, 200)
        payload = body(status)
        self.assertFalse(payload["oauth_configured"])
        self.assertFalse(payload["resource_authority_configured"])
        self.assertFalse(payload["public_activation"])
        self.assertTrue(payload["read_only"])
        serialized = json.dumps(payload).lower()
        self.assertNotIn("secret", serialized)
        self.assertNotIn("access_token", serialized)

        denied = http.handle(
            "GET",
            "/product/network/v1/space",
            auth_header(),
        )
        self.assertEqual(denied.status, 503)

    def test_three_initial_read_scopes_map_to_bounded_routes(self):
        oauth = StaticOAuth((
            "network.space.read",
            "network.directory.read",
            "network.communities.read",
        ))
        authority = RecordingAuthority()
        http = gateway.ProductNetworkHttpGateway(oauth_boundary=oauth, authority=authority)

        space = http.handle("GET", "/product/network/v1/space", auth_header())
        self.assertEqual(space.status, 200)
        self.assertEqual(body(space)["space"]["space_id"], SPACE)
        self.assertEqual(body(space)["space"]["visibility"], "hidden")

        directory = http.handle(
            "GET",
            "/product/network/v1/directory?category=food&limit=10",
            auth_header(),
        )
        self.assertEqual(directory.status, 200)
        self.assertEqual(len(body(directory)["entries"]), 1)
        self.assertEqual(
            authority.calls[1][2],
            {
                "search": None,
                "category": "food",
                "after_name": None,
                "after_space_id": None,
                "limit": 10,
            },
        )

        communities = http.handle(
            "GET",
            "/product/network/v1/communities?limit=25",
            auth_header(),
        )
        self.assertEqual(communities.status, 200)
        self.assertEqual(
            body(communities)["communities"][0]["community_id"],
            "industry.food.pizzeria.br",
        )
        self.assertEqual(oauth.calls, [TOKEN, TOKEN, TOKEN])

    def test_insufficient_scope_never_calls_network_authority(self):
        oauth = StaticOAuth(("network.space.read",))
        authority = RecordingAuthority()
        http = gateway.ProductNetworkHttpGateway(oauth_boundary=oauth, authority=authority)

        response = http.handle(
            "GET",
            "/product/network/v1/directory",
            auth_header(),
        )
        self.assertEqual(response.status, 403)
        self.assertEqual(body(response)["error"], "insufficient-scope")
        self.assertEqual(authority.calls, [])

    def test_invalid_token_and_write_methods_fail_before_authority(self):
        oauth = StaticOAuth(("network.space.read",))
        authority = RecordingAuthority()
        http = gateway.ProductNetworkHttpGateway(oauth_boundary=oauth, authority=authority)

        invalid = http.handle(
            "GET",
            "/product/network/v1/space",
            {"Authorization": "Bearer bad"},
        )
        self.assertEqual(invalid.status, 401)

        write = http.handle(
            "POST",
            "/product/network/v1/space",
            auth_header(),
        )
        self.assertEqual(write.status, 405)
        self.assertEqual(authority.calls, [])

    def test_directory_query_is_strict_and_cursor_is_atomic(self):
        oauth = StaticOAuth(("network.directory.read",))
        authority = RecordingAuthority()
        http = gateway.ProductNetworkHttpGateway(oauth_boundary=oauth, authority=authority)

        unknown = http.handle(
            "GET",
            "/product/network/v1/directory?unknown=x",
            auth_header(),
        )
        self.assertEqual(unknown.status, 400)

        incomplete = http.handle(
            "GET",
            "/product/network/v1/directory?after_name=Alpha",
            auth_header(),
        )
        self.assertEqual(incomplete.status, 400)
        self.assertEqual(authority.calls, [])

    def test_authority_rows_are_validated_before_response(self):
        class BadAuthority(RecordingAuthority):
            def list_communities(self, token, **kwargs):
                return [{"community_id": "javascript:bad"}]

        http = gateway.ProductNetworkHttpGateway(
            oauth_boundary=StaticOAuth(("network.communities.read",)),
            authority=BadAuthority(),
        )
        response = http.handle(
            "GET",
            "/product/network/v1/communities",
            auth_header(),
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(body(response)["error"], "resource-unavailable")

    def test_supabase_adapter_sends_only_token_digest_to_server_rpc(self):
        transport = RecordingTransport()
        config = adapter.SupabaseProductNetworkConfig(
            base_url="https://project.supabase.co",
            secret_key="sb_secret_backend_only",
            enabled=True,
        )
        authority = adapter.SupabaseProductNetworkReadAuthority(
            config,
            transport=transport,
        )

        authority.get_space(TOKEN)
        authority.list_directory(
            TOKEN,
            search=None,
            category="food",
            after_name=None,
            after_space_id=None,
            limit=20,
        )
        authority.list_communities(TOKEN, limit=50)

        digest = hashlib.sha256(TOKEN.encode("ascii")).hexdigest()
        self.assertEqual(len(transport.calls), 3)
        serialized = json.dumps(transport.calls)
        self.assertNotIn(TOKEN, serialized)
        self.assertIn(digest, serialized)
        for _, payload in transport.calls:
            self.assertEqual(payload["p_token_hash"], digest)

    def test_contract_keeps_runtime_disabled_and_write_scopes_out(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        self.assertFalse(contract["activation"]["public_enabled"])
        self.assertFalse(contract["activation"]["listener_deployed"])
        self.assertTrue(contract["resource"]["read_only"])
        self.assertEqual(
            set(contract["resource"]["scopes"]),
            {
                "network.space.read",
                "network.directory.read",
                "network.communities.read",
            },
        )
        serialized = json.dumps(contract)
        self.assertNotIn("network.messages.write", serialized)
        self.assertNotIn("network.groups.join", serialized)
        self.assertNotIn("product.acheguese.publish", serialized)


if __name__ == "__main__":
    unittest.main()
