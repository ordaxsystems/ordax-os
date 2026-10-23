"""Closed-by-default Public Account bridge to canonical MCP observational usage."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "services/public-identity"
sys.path.insert(0, str(SERVICE))
spec = importlib.util.spec_from_file_location("mcp_usage", SERVICE / "mcp_usage.py")
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)
import gateway as gateway_module


class FakeProvider:
    def get_user(self, token):
        if token != "fixture.valid.signed.jwt.token":
            raise gateway_module.SupabaseIdentityError("invalid")
        return ("11111111-1111-4111-8111-111111111111", "proof@example.invalid")


class FakeUsageReader:
    def __init__(self, value):
        self.value = value
        self.seen = []

    def read(self, token):
        self.seen.append(token)
        return self.value


def valid_usage():
    return {
        "ok": True, "schema": "ordax.product-mcp-usage/1",
        "observed_only": True, "billable": False,
        "current_month": "2026-10-01", "previous_month": "2026-09-01",
        "coverage": "partial_observational", "quota": None, "charge": None,
        "collection_active_now": True,
        "entries": [{"month": "2026-10-01", "tool_name": "ordax_targets", "tool_calls": 3}],
    }


class UsageBridgeTests(unittest.TestCase):
    def make_gateway(self, reader):
        return gateway_module.PublicIdentityGateway(provider=FakeProvider(), mcp_usage_reader=reader)

    def decode(self, response):
        return json.loads(response.body.decode())

    def test_public_account_gate_blocks_usage_when_not_activated(self):
        reader = FakeUsageReader(valid_usage())
        with patch.object(gateway_module, "PUBLIC_SITE_ACCOUNT_ENABLED", False):
            response = self.make_gateway(reader).handle(
                "GET", "/account/usage/mcp",
                {"cookie": "ordax_access=fixture.valid.signed.jwt.token", "x-ordax-public-site": "1"},
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(reader.seen, [])

    def test_verified_cookie_only_and_same_origin_projection(self):
        reader = FakeUsageReader(valid_usage())
        gateway = self.make_gateway(reader)
        with patch.object(gateway_module, "PUBLIC_SITE_ACCOUNT_ENABLED", True):
            denied = gateway.handle("GET", "/account/usage/mcp", {"x-ordax-public-site": "1"})
            self.assertEqual(denied.status, 401)
            self.assertEqual(reader.seen, [])
            ok = gateway.handle(
                "GET", "/account/usage/mcp?owner_user_id=22222222-2222-4222-8222-222222222222",
                {"cookie": "ordax_access=fixture.valid.signed.jwt.token", "x-ordax-public-site": "1"},
            )
        self.assertEqual(ok.status, 200)
        self.assertEqual(reader.seen, ["fixture.valid.signed.jwt.token"])
        self.assertEqual(self.decode(ok)["entries"][0]["tool_calls"], 3)
        self.assertIsNone(self.decode(ok)["charge"])
        self.assertEqual(dict(ok.headers)["Cache-Control"], "no-store, max-age=0")

    def test_invalid_upstream_and_wrong_method_fail_closed(self):
        invalid = valid_usage()
        invalid["billable"] = True
        reader = FakeUsageReader(invalid)
        gateway = self.make_gateway(reader)
        self.assertEqual(gateway.handle(
            "POST", "/account/usage/mcp",
            {"cookie": "ordax_access=fixture.valid.signed.jwt.token"},
        ).status, 405)
        failure = gateway.handle(
            "GET", "/account/usage/mcp",
            {"cookie": "ordax_access=fixture.valid.signed.jwt.token"},
        )
        self.assertEqual(failure.status, 503)
        self.assertEqual(self.decode(failure)["error"], "mcp-usage-unavailable")

    def test_no_account_or_unconfigured_provider_can_claim_measurement(self):
        gateway = gateway_module.PublicIdentityGateway(provider=FakeProvider(), mcp_usage_reader=FakeUsageReader(valid_usage()))
        self.assertEqual(gateway.handle("GET", "/account/usage/mcp").status, 401)
        with patch.dict("os.environ", {"ORDAX_MCP_USAGE_READ_ENABLED": "0"}):
            unconfigured = gateway_module.PublicIdentityGateway(provider=FakeProvider())
            self.assertEqual(unconfigured.handle(
                "GET", "/account/usage/mcp", {"cookie": "ordax_access=fixture.valid.signed.jwt.token"},
            ).status, 503)

    def test_adapter_validates_and_bounds_every_value(self):
        good = valid_usage()
        self.assertEqual(usage.validated_usage(good)["entries"][0]["tool_calls"], 3)
        for edits in [
            {"billable": True}, {"collection_active_now": "yes"},
            {"entries": [{"month": "2026-10-01", "tool_name": "../secret", "tool_calls": 3}]},
            {"entries": [{"month": "2026-10-01", "tool_name": "ordax_targets", "tool_calls": 1.5}]},
            {"entries": [good["entries"][0], good["entries"][0]]},
            {"quota": 10000}, {"coverage": "complete"},
        ]:
            with self.subTest(edits=edits), self.assertRaises(usage.ProductMcpUsageError):
                usage.validated_usage({**good, **edits})

    def test_bearer_remains_inside_server_adapter(self):
        class FakeTransport:
            def __init__(self):
                self.seen = None
            def request(self, headers):
                self.seen = dict(headers)
                return 200, json.dumps(valid_usage()).encode()
        transport = FakeTransport()
        reader = usage.ProductMcpUsageReader(transport=transport)
        result = reader.read("fixture.valid.signed.jwt.token")
        self.assertEqual(result["entries"][0]["tool_calls"], 3)
        self.assertEqual(transport.seen["Authorization"], "Bearer fixture.valid.signed.jwt.token")
        for token in ["", "line\nbreak", "no spaces", "x"]:
            with self.assertRaises(usage.ProductMcpUsageError):
                reader.read(token)


if __name__ == "__main__":
    unittest.main()
