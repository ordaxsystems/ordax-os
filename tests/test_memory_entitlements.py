import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = ROOT / "services" / "public-identity"
MODULE_PATH = SERVICE_ROOT / "memory_entitlements.py"

spec = importlib.util.spec_from_file_location("ordax_memory_entitlements", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class FakeIdentityProvider:
    def __init__(self, subject="account-a"):
        self.subject = subject
        self.tokens = []

    def get_user(self, access_token):
        self.tokens.append(access_token)
        return self.subject, "user@example.com"


class FakeMemoryProvider:
    def __init__(self, allowed):
        self.allowed = allowed
        self.tokens = []

    def has_account_cloud_entitlement(self, access_token):
        self.tokens.append(access_token)
        return self.allowed


class AccountMemoryEntitlementAuthorityTests(unittest.TestCase):
    def test_allowed_decision_is_server_authoritative_and_subject_comes_from_token(self):
        identity = FakeIdentityProvider("account-from-token")
        memory = FakeMemoryProvider(True)
        authority = module.AccountMemoryEntitlementAuthority(identity, memory)

        decision = authority.resolve("authenticated-access-token")

        self.assertEqual(decision, {
            "schema": "ordax.entitlements/1",
            "subjectType": "account",
            "subjectId": "account-from-token",
            "key": "memory.cloud.enabled",
            "decision": "allowed",
            "value": None,
            "authority": "server",
            "expiresAt": None,
        })
        self.assertEqual(identity.tokens, ["authenticated-access-token"])
        self.assertEqual(memory.tokens, ["authenticated-access-token"])

    def test_denied_entitlement_remains_an_explicit_server_decision(self):
        authority = module.AccountMemoryEntitlementAuthority(
            FakeIdentityProvider("account-a"),
            FakeMemoryProvider(False),
        )

        decision = authority.resolve("authenticated-access-token")

        self.assertEqual(decision["subjectId"], "account-a")
        self.assertEqual(decision["decision"], "denied")
        self.assertEqual(decision["authority"], "server")

    def test_client_cannot_request_an_arbitrary_subject(self):
        authority = module.AccountMemoryEntitlementAuthority(
            FakeIdentityProvider("actual-account"),
            FakeMemoryProvider(True),
        )

        decision = authority.resolve("authenticated-access-token")

        self.assertNotIn("requestedSubjectId", decision)
        self.assertEqual(decision["subjectId"], "actual-account")

    def test_only_memory_cloud_entitlement_can_be_resolved(self):
        memory = FakeMemoryProvider(True)
        authority = module.AccountMemoryEntitlementAuthority(
            FakeIdentityProvider("account-a"),
            memory,
        )

        with self.assertRaisesRegex(ValueError, "unsupported-memory-entitlement"):
            authority.resolve("authenticated-access-token", "storage.unrelated.enabled")

        self.assertEqual(memory.tokens, [])

    def test_identity_failure_prevents_entitlement_lookup(self):
        class FailingIdentity:
            def get_user(self, access_token):
                raise RuntimeError("invalid-authenticated-session")

        memory = FakeMemoryProvider(True)
        authority = module.AccountMemoryEntitlementAuthority(FailingIdentity(), memory)

        with self.assertRaisesRegex(RuntimeError, "invalid-authenticated-session"):
            authority.resolve("expired-token")

        self.assertEqual(memory.tokens, [])

    def test_invalid_provider_contracts_are_rejected_at_composition_time(self):
        with self.assertRaises(TypeError):
            module.AccountMemoryEntitlementAuthority(object(), FakeMemoryProvider(True))
        with self.assertRaises(TypeError):
            module.AccountMemoryEntitlementAuthority(FakeIdentityProvider(), object())


if __name__ == "__main__":
    unittest.main()
