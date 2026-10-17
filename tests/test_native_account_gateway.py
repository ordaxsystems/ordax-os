import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_account_gateway.py"

spec = importlib.util.spec_from_file_location("ordax_native_account_gateway_test", MODULE)
gateway = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway
spec.loader.exec_module(gateway)


class NativeAccountGatewayTests(unittest.TestCase):
    def test_only_https_ordax_gateway_base_url_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            with self.assertRaises(ValueError):
                gateway.NativeAccountGateway("http://accounts.example", path)
            with self.assertRaises(ValueError):
                gateway.NativeAccountGateway("https://user@example.com", path)
            with self.assertRaises(ValueError):
                gateway.NativeAccountGateway("https://accounts.example/path/", path)
            client = gateway.NativeAccountGateway(
                "https://accounts.example/functions/v1/ordax-account-gateway",
                path,
            )
            self.assertEqual(
                client.base_url,
                "https://accounts.example/functions/v1/ordax-account-gateway",
            )

    def test_legacy_plaintext_session_is_purged_and_never_loaded(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "account" / "session.json"
            path.parent.mkdir()
            path.write_text(
                json.dumps({"ordax_access": "old-access", "ordax_refresh": "old-refresh"}),
                encoding="utf-8",
            )
            client = gateway.NativeAccountGateway("https://accounts.example", str(path))
            self.assertEqual(client._cookies, {})
            self.assertFalse(path.exists())

    def test_legacy_symlink_is_unlinked_without_touching_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "stolen-copy.json"
            target.write_text(
                json.dumps({"ordax_access": "old-access", "ordax_refresh": "old-refresh"}),
                encoding="utf-8",
            )
            link = root / "session.json"
            link.symlink_to(target)
            client = gateway.NativeAccountGateway("https://accounts.example", str(link))
            self.assertEqual(client._cookies, {})
            self.assertFalse(link.exists())
            self.assertTrue(target.exists())

    def test_directory_at_legacy_path_is_not_removed_or_used_as_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "session.json"
            path.mkdir()
            client = gateway.NativeAccountGateway("https://accounts.example", str(path))
            self.assertEqual(client._cookies, {})
            self.assertTrue(path.is_dir())

    def test_account_cookies_are_memory_only_and_no_persist_api_exists(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "account" / "session.json"
            client = gateway.NativeAccountGateway("https://accounts.example", str(path))
            client._cookies = gateway._parse_set_cookies(
                (
                    "ordax_access=access-value; Path=/; HttpOnly; Secure",
                    "ordax_refresh=refresh-value; Path=/; HttpOnly; Secure",
                ),
                client._cookies,
            )
            self.assertEqual(
                client._cookies,
                {"ordax_access": "access-value", "ordax_refresh": "refresh-value"},
            )
            self.assertFalse(path.exists())
            self.assertFalse(hasattr(client, "_persist_session"))
            self.assertFalse(hasattr(client, "_load_session"))

    def test_new_process_never_recovers_previous_in_memory_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "account" / "session.json"
            first = gateway.NativeAccountGateway("https://accounts.example", str(path))
            first._cookies = {"ordax_access": "a", "ordax_refresh": "b"}
            second = gateway.NativeAccountGateway("https://accounts.example", str(path))
            self.assertEqual(second._cookies, {})
            self.assertFalse(path.exists())

    def test_product_access_token_is_native_only_and_requires_authenticated_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            with self.assertRaises(gateway.NativeAccountGatewayError) as raised:
                client._product_access_token()
            self.assertEqual(raised.exception.code, "authentication-required")
            self.assertEqual(raised.exception.status, 401)

            client._cookies = {
                "ordax_access": "access-value",
                "ordax_refresh": "refresh-value",
            }
            self.assertEqual(client._product_access_token(), "access-value")

    def test_registration_policy_is_read_only_and_uses_existing_session_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"$schema":"prototype-ordax.registration-legal-policy/1"}',
                )

            client._request = fake_request
            reply = client.registration_policy()

            self.assertEqual(reply.status, 200)
            self.assertEqual(calls, [("GET", "/auth/registration-policy", {})])

    def test_registration_posts_only_affirmative_legal_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(status=303, headers={}, body=b"")

            client._request = fake_request
            with self.assertRaises(gateway.NativeAccountGatewayError):
                client.register("person@example.com", "secret-123456", legal_accepted=False)

            reply = client.register(
                "person@example.com",
                "secret-123456",
                legal_accepted=True,
            )
            self.assertEqual(reply.status, 303)
            self.assertEqual(len(calls), 1)
            method, route, kwargs = calls[0]
            self.assertEqual((method, route), ("POST", "/auth/register"))
            body = kwargs["body"].decode("utf-8")
            self.assertIn("email=person%40example.com", body)
            self.assertIn("legal_acceptance=accepted", body)
            self.assertNotIn("privacy_version", body)
            self.assertNotIn("terms_version", body)

    def test_account_close_requires_exact_confirmation_before_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"closed":true}',
                )

            client._request = fake_request
            with self.assertRaises(gateway.NativeAccountGatewayError):
                client.close_account("current-secret", "yes")
            self.assertEqual(calls, [])

    def test_account_close_forwards_only_transient_password_and_confirmation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"closed":true}',
                )

            client._request = fake_request
            reply = client.close_account("current-secret", "close-account")

            self.assertEqual(reply.status, 200)
            self.assertEqual(len(calls), 1)
            method, route, kwargs = calls[0]
            self.assertEqual((method, route), ("POST", "/account/close"))
            self.assertEqual(
                kwargs["content_type"],
                "application/x-www-form-urlencoded",
            )
            body = kwargs["body"].decode("utf-8")
            self.assertIn("password=current-secret", body)
            self.assertIn("confirmation=close-account", body)
            self.assertNotIn("service_role", body.lower())

    def test_account_export_is_read_only_and_uses_existing_session_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"$schema":"prototype-ordax.account-export/1"}',
                )

            client._request = fake_request
            reply = client.account_export()

            self.assertEqual(reply.status, 200)
            self.assertEqual(calls, [("GET", "/account/export", {})])

    def test_spaces_read_is_get_only_and_uses_existing_session_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"$schema":"prototype-ordax.account-spaces/1","spaces":[]}',
                )

            client._request = fake_request
            reply = client.spaces()

            self.assertEqual(reply.status, 200)
            self.assertEqual(calls, [("GET", "/account/spaces", {})])

    def test_space_members_read_is_get_only_and_preserves_bounded_query(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=b'{"schema":"ordax.space-members-page/1","spaceId":"space-1","members":[],"nextCursor":null}',
                )

            client._request = fake_request
            reply = client.space_members("spaceId=space-1&cursor=member-1")

            self.assertEqual(reply.status, 200)
            self.assertEqual(
                calls,
                [("GET", "/account/space-members?spaceId=space-1&cursor=member-1", {})],
            )
            with self.assertRaises(ValueError):
                client.space_members("x" * 2049)
            with self.assertRaises(ValueError):
                client.space_members("spaceId=ok#fragment")
    def test_memory_entitlement_read_is_get_only_and_reuses_process_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=(
                        b'{"schema":"ordax.entitlements/1","subjectType":"account",'
                        b'"subjectId":"user-1","key":"memory.cloud.enabled",'
                        b'"decision":"denied","value":null,"authority":"server",'
                        b'"expiresAt":null}'
                    ),
                )

            client._request = fake_request
            reply = client.memory_cloud_entitlement()

            self.assertEqual(reply.status, 200)
            self.assertEqual(
                calls,
                [("GET", "/account/entitlements/memory-cloud", {})],
            )
            payload = json.loads(reply.body.decode("utf-8"))
            self.assertEqual(payload["authority"], "server")
            self.assertEqual(payload["key"], "memory.cloud.enabled")
            self.assertEqual(payload["decision"], "denied")

    def test_network_send_is_post_only_json_and_reuses_process_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "session.json")
            client = gateway.NativeAccountGateway("https://accounts.example", path)
            calls = []

            def fake_request(method, route, **kwargs):
                calls.append((method, route, kwargs))
                return gateway.GatewayReply(
                    status=200,
                    headers={},
                    body=(
                        b'{"schema":"prototype-ordax.network-mutation-outcome/2",'
                        b'"outcome":"applied","operation":"message-send",'
                        b'"code":"message-applied","resource_id":"message-00000001",'
                        b'"retry_after_seconds":null,'
                        b'"idempotency_key":"message-key-00000001"}'
                    ),
                )

            client._request = fake_request
            raw = b'{"space_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"}'
            reply = client.send_network_message(raw)
            self.assertEqual(reply.status, 200)
            self.assertEqual(
                calls,
                [(
                    "POST",
                    "/network/v2/messages/send",
                    {"body": raw, "content_type": "application/json"},
                )],
            )

    def test_native_adapter_has_no_provider_or_plaintext_persistence_dependency(self):
        source = MODULE.read_text(encoding="utf-8").lower()
        self.assertNotIn("supabase", source)
        self.assertIn("/auth/session", source)
        self.assertIn("/auth/registration-policy", source)
        self.assertIn("legal_acceptance", source)
        self.assertIn("/account/export", source)
        self.assertIn("/account/spaces", source)
        self.assertIn("/account/space-members", source)
        self.assertIn("/account/entitlements/memory-cloud", source)
        self.assertIn("/sync/objects", source)
        self.assertIn("/sync/snapshot", source)
        self.assertIn("/sync/changes", source)
        self.assertIn("/network/v2/messages/send", source)
        self.assertNotIn("_persist_session", source)
        self.assertNotIn("_load_session", source)
        self.assertNotIn("json.dump", source)
        self.assertNotIn("open(self.legacy_session_path", source)
        self.assertNotIn("/device/enroll", source)
        self.assertNotIn("/v3/device/setup", source)


if __name__ == "__main__":
    unittest.main()
