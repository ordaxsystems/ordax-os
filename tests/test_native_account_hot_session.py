"""Regression tests for same-boot Native account continuity without USB secrets."""
from __future__ import annotations

from email.message import Message
from pathlib import Path
import sys
import tempfile
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
from native_account_gateway import NativeAccountGateway, NativeAccountGatewayError
from native_account_hot_session import NativeKernelAccountSession


class FakeKernelMemory:
    def __init__(self):
        self.value = {}
        self.reads = 0

    def load(self):
        self.reads += 1
        return dict(self.value)

    def save(self, cookies):
        self.value = dict(cookies)


class FakeResponse:
    status = 200

    def __init__(self, headers):
        self.headers = Message()
        for value in headers:
            self.headers.add_header("Set-Cookie", value)

    def read(self, _maximum):
        return b'{"authenticated":true}'

    def close(self):
        pass


class FakeOpener:
    def __init__(self, headers):
        self.headers = headers

    def open(self, _request, timeout=None):
        return FakeResponse(self.headers)


class NativeHotSessionTests(unittest.TestCase):
    def test_verified_cookies_survive_new_gateway_instance_same_boot(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_file = Path(tmp) / "session.json"
            memory = FakeKernelMemory()
            first = NativeAccountGateway("https://accounts.example", str(original_file), hot_session_store=memory)
            first._opener = FakeOpener((
                "ordax_access=opaque-access; Secure; HttpOnly",
                "ordax_refresh=opaque-refresh; Secure; HttpOnly",
            ))
            self.assertEqual(first.login("user@example.com", "password-only-in-memory").status, 200)
            self.assertEqual(memory.value, {"ordax_access": "opaque-access", "ordax_refresh": "opaque-refresh"})
            self.assertFalse(original_file.exists(), "USB plaintext session must not exist")

            restarted = NativeAccountGateway("https://accounts.example", str(original_file), hot_session_store=memory)
            self.assertEqual(restarted._cookies, memory.value)
            self.assertEqual(restarted._product_access_token(), "opaque-access")
            restarted._opener = FakeOpener(())
            restarted.logout()
            self.assertEqual(memory.value, {})
            after_logout = NativeAccountGateway("https://accounts.example", str(original_file), hot_session_store=memory)
            self.assertEqual(after_logout._cookies, {})
            self.assertFalse(original_file.exists())

    def test_kernel_failure_does_not_store_tokens_in_usb_or_block_login(self):
        class Unavailable:
            def load(self):
                raise OSError("ENOSYS")
            def save(self, _cookies):
                raise OSError("ENOSYS")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.json"
            client = NativeAccountGateway("https://accounts.example", str(path), hot_session_store=Unavailable())
            self.assertEqual(client._cookies, {})
            client._opener = FakeOpener((
                "ordax_access=a; HttpOnly; Secure",
                "ordax_refresh=b; HttpOnly; Secure",
            ))
            self.assertEqual(client.login("user@example.com", "secret").status, 200)
            self.assertFalse(path.exists())

    def test_plaintext_legacy_session_is_purged_before_keyring_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.json"
            path.write_text('{"ordax_refresh":"unsafe-on-usb"}', encoding="utf-8")
            memory = FakeKernelMemory()
            memory.value = {"ordax_access":"current", "ordax_refresh":"current"}
            client = NativeAccountGateway("https://accounts.example", str(path), hot_session_store=memory)
            self.assertFalse(path.exists())
            self.assertEqual(client._cookies, memory.value)

    def test_kernel_cache_is_linux_amd64_memory_only_and_does_not_touch_file_api(self):
        source = (RUNTIME / "native_account_hot_session.py").read_text(encoding="utf-8")
        self.assertIn("_KEY_SPEC_USER_KEYRING = -4", source)
        self.assertIn("_KEYCTL_REVOKE", source)
        self.assertIn("_SESSION_TTL_SECONDS", source)
        self.assertNotIn("os.write", source)
        self.assertNotIn("open(", source)
        self.assertTrue(hasattr(NativeKernelAccountSession, "clear"))


if __name__ == "__main__":
    unittest.main()
