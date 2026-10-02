import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "services" / "public-identity" / "supabase_registration_legal.py"
spec = importlib.util.spec_from_file_location("ordax_supabase_registration_legal", MODULE)
legal_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = legal_module
spec.loader.exec_module(legal_module)


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), body))
        return self.responses.pop(0)


class SupabaseRegistrationLegalAuthorityTests(unittest.TestCase):
    def authority(self, responses):
        transport = FakeTransport(responses)
        authority = legal_module.SupabaseRegistrationLegalAuthority(
            "https://ordax-example.supabase.co",
            "sb_secret_backend-only",
            transport=transport,
        )
        return authority, transport

    def test_begin_intent_is_server_only_and_asserts_acceptance(self):
        intent_id = "11111111-1111-4111-8111-111111111111"
        authority, transport = self.authority([
            (200, json.dumps([{"intent_id": intent_id, "expires_at": "2026-10-02T22:30:00Z"}]).encode())
        ])

        intent = authority.begin_intent(" Person@Example.com ")
        self.assertEqual(intent.intent_id, intent_id)

        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/ordax_begin_account_registration_legal_intent_v1"))
        self.assertEqual(headers["apikey"], "sb_secret_backend-only")
        self.assertNotIn("Authorization", headers)
        self.assertEqual(
            json.loads(body),
            {
                "p_normalized_email": "person@example.com",
                "p_accepted": True,
            },
        )

    def test_authority_rejects_non_https_or_invalid_secret_config(self):
        with self.assertRaises(ValueError):
            legal_module.SupabaseRegistrationLegalAuthority(
                "http://ordax-example.supabase.co",
                "sb_secret_backend-only",
            )
        for key in ("", "has whitespace"):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    legal_module.SupabaseRegistrationLegalAuthority(
                        "https://ordax-example.supabase.co",
                        key,
                    )

    def test_authority_fails_closed_on_provider_or_shape_error(self):
        authority, _ = self.authority([(503, b"{}")])
        with self.assertRaises(legal_module.RegistrationLegalError):
            authority.begin_intent("person@example.com")

        authority, _ = self.authority([(200, b"[]")])
        with self.assertRaises(legal_module.RegistrationLegalError):
            authority.begin_intent("person@example.com")

        authority, _ = self.authority([(200, b'[{"intent_id":"not-a-uuid"}]')])
        with self.assertRaises(legal_module.RegistrationLegalError):
            authority.begin_intent("person@example.com")


if __name__ == "__main__":
    unittest.main()
