import json
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "services" / "public-identity" / "supabase_password.py"
spec = importlib.util.spec_from_file_location("ordax_supabase_password", MODULE)
provider_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = provider_module
spec.loader.exec_module(provider_module)


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), body))
        status, value = self.responses.pop(0)
        return status, json.dumps(value).encode("utf-8")


class SupabasePasswordProviderTests(unittest.TestCase):
    def provider(self, responses):
        transport = FakeTransport(responses)
        provider = provider_module.SupabasePasswordProvider(
            "https://ordax-example.supabase.co",
            "sb_publishable_1234567890",
            transport=transport,
        )
        return provider, transport

    def test_rejects_secret_or_non_https_configuration(self):
        with self.assertRaises(ValueError):
            provider_module.SupabasePasswordProvider(
                "http://ordax-example.supabase.co",
                "sb_publishable_1234567890",
            )
        for key in ("sb_secret_1234567890", "legacy-anon-key", "service_role"):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    provider_module.SupabasePasswordProvider(
                        "https://ordax-example.supabase.co",
                        key,
                    )

    def test_password_sign_in_uses_public_auth_endpoint_and_returns_session(self):
        provider, transport = self.provider([
            (200, {
                "access_token": "access",
                "refresh_token": "refresh",
                "expires_in": 3600,
                "token_type": "bearer",
                "user": {"id": "user-1", "email": "person@example.com"},
            })
        ])
        result = provider.sign_in_with_password(" person@example.com ", "secret-pass-12")

        self.assertEqual(result.subject_id, "user-1")
        self.assertEqual(result.email, "person@example.com")
        self.assertFalse(result.email_confirmation_required)
        self.assertEqual(result.session.access_token, "access")

        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/auth/v1/token?grant_type=password"))
        self.assertEqual(headers["apikey"], "sb_publishable_1234567890")
        self.assertNotIn("Authorization", headers)
        self.assertEqual(
            json.loads(body),
            {"email": "person@example.com", "password": "secret-pass-12"},
        )

    def test_signup_without_session_is_reported_as_email_confirmation_required(self):
        provider, _ = self.provider([
            (200, {"user": {"id": "user-2", "email": "new@example.com"}})
        ])
        result = provider.sign_up_with_password("new@example.com", "secret-pass-12")
        self.assertIsNone(result.session)
        self.assertTrue(result.email_confirmation_required)

    def test_signup_carries_only_server_issued_registration_intent_metadata(self):
        provider, transport = self.provider([
            (200, {"user": {"id": "user-2", "email": "new@example.com"}})
        ])
        intent_id = "11111111-1111-4111-8111-111111111111"
        provider.sign_up_with_password(
            "new@example.com",
            "secret-pass-12",
            registration_intent_id=intent_id,
        )
        body = json.loads(transport.calls[0][3])
        self.assertEqual(
            body,
            {
                "email": "new@example.com",
                "password": "secret-pass-12",
                "data": {"ordax_registration_intent_id": intent_id},
            },
        )
        self.assertNotIn("privacy_version", json.dumps(body))
        self.assertNotIn("terms_version", json.dumps(body))

    def test_signup_rejects_invalid_registration_intent_before_network(self):
        provider, transport = self.provider([])
        with self.assertRaises(ValueError):
            provider.sign_up_with_password(
                "new@example.com",
                "secret-pass-12",
                registration_intent_id="not-a-uuid",
            )
        self.assertEqual(transport.calls, [])

    def test_signup_rejects_passwords_shorter_than_ordax_policy(self):
        provider, transport = self.provider([])
        with self.assertRaises(ValueError):
            provider.sign_up_with_password("new@example.com", "short-pass")
        self.assertEqual(transport.calls, [])

    def test_login_does_not_retroactively_reject_existing_shorter_password(self):
        provider, transport = self.provider([
            (200, {
                "access_token": "access",
                "refresh_token": "refresh",
                "expires_in": 3600,
                "token_type": "bearer",
                "user": {"id": "user-1", "email": "person@example.com"},
            })
        ])
        result = provider.sign_in_with_password("person@example.com", "old-pass")
        self.assertEqual(result.subject_id, "user-1")
        self.assertEqual(len(transport.calls), 1)

    def test_password_recovery_uses_public_recover_endpoint_without_exposing_secrets(self):
        provider, transport = self.provider([(200, {})])
        provider.request_password_recovery(
            " person@example.com ",
            "https://accounts.ordax.example/recuperar/concluir",
        )
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertIn("/auth/v1/recover?redirect_to=", url)
        self.assertIn("https%3A%2F%2Faccounts.ordax.example%2Frecuperar%2Fconcluir", url)
        self.assertEqual(json.loads(body), {"email": "person@example.com"})
        self.assertNotIn("Authorization", headers)

    def test_password_recovery_requires_clean_https_redirect(self):
        provider, transport = self.provider([])
        for redirect in (
            "http://accounts.ordax.example/recover",
            "https://user@accounts.ordax.example/recover",
            "https://accounts.ordax.example/recover?token=x",
            "https://accounts.ordax.example/recover#fragment",
        ):
            with self.subTest(redirect=redirect):
                with self.assertRaises(ValueError):
                    provider.request_password_recovery("person@example.com", redirect)
        self.assertEqual(transport.calls, [])

    def test_recovery_token_verification_returns_ephemeral_session(self):
        provider, transport = self.provider([
            (200, {
                "access_token": "recovery-access",
                "refresh_token": "recovery-refresh",
                "expires_in": 900,
                "token_type": "bearer",
                "user": {"id": "user-1", "email": "person@example.com"},
            })
        ])
        session = provider.verify_recovery_token("a" * 64)
        self.assertEqual(session.access_token, "recovery-access")
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/auth/v1/verify"))
        self.assertEqual(
            json.loads(body),
            {"token_hash": "a" * 64, "type": "recovery"},
        )
        self.assertNotIn("Authorization", headers)

    def test_recovery_password_update_requires_ordax_policy_and_bearer_session(self):
        provider, transport = self.provider([(200, {"id": "user-1"})])
        provider.update_password("recovery-access", "new-password-12")
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith("/auth/v1/user"))
        self.assertEqual(headers["Authorization"], "Bearer recovery-access")
        self.assertEqual(json.loads(body), {"password": "new-password-12"})

        provider, transport = self.provider([])
        with self.assertRaises(ValueError):
            provider.update_password("recovery-access", "short")
        self.assertEqual(transport.calls, [])

    def test_recovery_token_hash_is_bounded_and_contains_no_whitespace(self):
        provider, transport = self.provider([])
        for token_hash in ("short", "a b" * 20, "a" * 2049):
            with self.subTest(token_hash=token_hash[:20]):
                with self.assertRaises(ValueError):
                    provider.verify_recovery_token(token_hash)
        self.assertEqual(transport.calls, [])

    def test_refresh_get_user_and_logout_use_bearer_token_only_when_needed(self):
        provider, transport = self.provider([
            (200, {
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_in": 3600,
                "token_type": "bearer",
            }),
            (200, {"id": "user-1", "email": "person@example.com"}),
            (200, {}),
        ])
        session = provider.refresh_session("old-refresh")
        self.assertEqual(session.access_token, "new-access")
        self.assertEqual(
            provider.get_user("new-access"),
            ("user-1", "person@example.com"),
        )
        provider.sign_out("new-access")

        self.assertNotIn("Authorization", transport.calls[0][2])
        self.assertEqual(
            transport.calls[1][2]["Authorization"],
            "Bearer new-access",
        )
        self.assertEqual(
            transport.calls[2][2]["Authorization"],
            "Bearer new-access",
        )

    def test_provider_errors_are_bounded_and_do_not_echo_passwords(self):
        provider, _ = self.provider([
            (400, {"error_code": "invalid_credentials", "msg": "bad login"})
        ])
        with self.assertRaises(provider_module.SupabaseIdentityError) as caught:
            provider.sign_in_with_password("person@example.com", "TOP-SECRET")
        self.assertEqual(caught.exception.code, "provider-invalid_credentials")
        self.assertNotIn("TOP-SECRET", str(caught.exception))

    def test_credentials_reject_newline_email_empty_password_and_nul(self):
        provider, _ = self.provider([])
        cases = (
            ("bad\n@example.com", "secret"),
            ("person@example.com", ""),
            ("person@example.com", "bad\x00secret"),
        )
        for email, password in cases:
            with self.subTest(email=email):
                with self.assertRaises(ValueError):
                    provider.sign_in_with_password(email, password)


if __name__ == "__main__":
    unittest.main()
