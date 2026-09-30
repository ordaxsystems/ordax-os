import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = ROOT / "services" / "public-identity"
GATEWAY_PATH = SERVICE_ROOT / "gateway.py"

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

spec = importlib.util.spec_from_file_location("ordax_memory_entitlement_gateway", GATEWAY_PATH)
gateway_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway_module
spec.loader.exec_module(gateway_module)


class IdentityProvider:
    def __init__(self, subject="account-a"):
        self.subject = subject
        self.tokens = []

    def get_user(self, access_token):
        self.tokens.append(access_token)
        return self.subject, "account@example.test"


class MemoryProvider:
    def __init__(self, allowed=False, fail=False):
        self.allowed = allowed
        self.fail = fail
        self.tokens = []

    def has_account_cloud_entitlement(self, access_token):
        self.tokens.append(access_token)
        if self.fail:
            raise gateway_module.SupabaseMemoryError("provider-memory-failed", status=503)
        return self.allowed


class MemoryEntitlementGatewayRouteTests(unittest.TestCase):
    def payload(self, response):
        return json.loads(response.body.decode("utf-8"))

    def gateway(self, *, allowed=False, fail=False, subject="account-a"):
        identity = IdentityProvider(subject)
        memory = MemoryProvider(allowed=allowed, fail=fail)
        gateway = gateway_module.PublicIdentityGateway(
            provider=identity,
            sync_provider=None,
            account_provider=None,
            lifecycle_provider=None,
            memory_provider=memory,
        )
        return gateway, identity, memory

    def test_authenticated_allowed_decision_is_server_authoritative_and_subject_bound(self):
        gateway, identity, memory = self.gateway(allowed=True, subject="account-a")
        response = gateway.handle(
            "GET",
            "/account/entitlements/memory-cloud",
            {"Cookie": "ordax_access=access-a", "Accept": "application/json"},
        )

        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertEqual(payload["schema"], "ordax.entitlements/1")
        self.assertEqual(payload["subjectType"], "account")
        self.assertEqual(payload["subjectId"], "account-a")
        self.assertEqual(payload["key"], "memory.cloud.enabled")
        self.assertEqual(payload["decision"], "allowed")
        self.assertEqual(payload["authority"], "server")
        self.assertEqual(identity.tokens, ["access-a", "access-a"])
        self.assertEqual(memory.tokens, ["access-a"])

    def test_authenticated_missing_grant_returns_server_denied_not_local_default(self):
        gateway, _, _ = self.gateway(allowed=False)
        response = gateway.handle(
            "GET",
            "/account/entitlements/memory-cloud",
            {"Cookie": "ordax_access=access-a"},
        )
        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertEqual(payload["decision"], "denied")
        self.assertEqual(payload["authority"], "server")

    def test_unauthenticated_read_is_rejected_and_does_not_consult_entitlements(self):
        gateway, _, memory = self.gateway(allowed=True)
        response = gateway.handle("GET", "/account/entitlements/memory-cloud")
        self.assertEqual(response.status, 401)
        self.assertEqual(self.payload(response)["error"], "authentication-required")
        self.assertEqual(memory.tokens, [])

    def test_provider_failure_is_fail_closed(self):
        gateway, _, _ = self.gateway(allowed=True, fail=True)
        response = gateway.handle(
            "GET",
            "/account/entitlements/memory-cloud",
            {"Cookie": "ordax_access=access-a"},
        )
        self.assertEqual(response.status, 502)
        self.assertEqual(self.payload(response)["error"], "memory-entitlement-read-failed")

    def test_route_is_read_only(self):
        gateway, _, memory = self.gateway(allowed=True)
        response = gateway.handle(
            "POST",
            "/account/entitlements/memory-cloud",
            {"Cookie": "ordax_access=access-a"},
            b"{}",
        )
        self.assertEqual(response.status, 405)
        self.assertIn(("Allow", "GET"), response.headers)
        self.assertEqual(memory.tokens, [])

    def test_public_site_gate_keeps_route_disabled_with_account_surface(self):
        gateway, _, memory = self.gateway(allowed=True)
        response = gateway.handle(
            "GET",
            "/account/entitlements/memory-cloud",
            {"X-OrdaX-Public-Site": "1", "Cookie": "ordax_access=access-a"},
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "public-account-access-disabled")
        self.assertEqual(memory.tokens, [])


if __name__ == "__main__":
    unittest.main()
