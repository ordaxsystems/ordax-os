"""Regression for OrdaX account continuity without a second identity authority."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))

import native_account_gateway as gateway
from native_account_vault import AccountVaultError, NativeAccountVault

ORIGIN = "https://accounts.example.com/functions/v1/ordax-account-gateway"
STRONG = "unique-passphrase-for-test-2026"
COOKIES = {"ordax_access": "signed.access", "ordax_refresh": "signed.refresh"}


def verified():
    return gateway.GatewayReply(
        status=200, headers={},
        body=json.dumps({
            "$schema": gateway.SESSION_SCHEMA,
            "authenticated": True, "status": "authenticated",
            "subject": "subject-1", "email": "person@example.com",
            "provider": "supabase",
        }).encode(),
    )


class NoHotSession:
    def load(self):
        return {}

    def save(self, value):
        pass


class NativeAccountVaultTests(unittest.TestCase):
    def test_aes_gcm_round_trip_wrong_passphrase_and_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "account" / "session.vault")
            first = NativeAccountVault(path, ORIGIN)
            self.assertEqual(first.unlock(STRONG), {})
            first.save(COOKIES)
            contents = Path(path).read_bytes()
            self.assertNotIn(b"signed.refresh", contents)
            self.assertNotIn(STRONG.encode(), contents)
            self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)
            first.lock()
            with self.assertRaises(AccountVaultError):
                first.unlock("another-strong-incorrect-passphrase")
            self.assertEqual(first.unlock(STRONG), COOKIES)
            first.lock()
            obj = json.loads(contents)
            obj["nonce"] = "AAAAAAAAAAAAAAAA"
            Path(path).write_text(json.dumps(obj), encoding="utf-8")
            with self.assertRaises(AccountVaultError):
                first.unlock(STRONG)

    def test_short_pin_does_not_create_offline_guessable_refresh_vault(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "account" / "session.vault")
            v = NativeAccountVault(path, ORIGIN)
            self.assertEqual(v.unlock("123456"), {})
            v.save(COOKIES)
            self.assertFalse(Path(path).exists())

    def test_symlink_and_permissions_do_not_expose_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vault = root / "account" / "session.vault"
            vault.parent.mkdir(mode=0o700)
            target = root / "unrelated.json"
            target.write_text("do not touch", encoding="utf-8")
            vault.symlink_to(target)
            with self.assertRaises(AccountVaultError):
                NativeAccountVault(str(vault), ORIGIN).unlock(STRONG)
            self.assertEqual(target.read_text(), "do not touch")
            vault.unlink()
            vault.write_text("{}", encoding="utf-8")
            vault.chmod(0o644)
            with self.assertRaises(AccountVaultError):
                NativeAccountVault(str(vault), ORIGIN).unlock(STRONG)

    def test_vault_is_gateway_bound_and_logout_deletes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "account" / "session.vault")
            first = NativeAccountVault(path, ORIGIN)
            first.unlock(STRONG)
            first.save(COOKIES)
            with self.assertRaises(AccountVaultError):
                NativeAccountVault(path, "https://another.example.com").unlock(STRONG)
            first.clear()
            self.assertFalse(Path(path).exists())

    def test_verified_account_reboot_unlock_and_explicit_logout(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "old.json")
            path = str(Path(directory) / "account" / "session.vault")
            def client():
                return gateway.NativeAccountGateway(
                    ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path,
                )
            first = client()
            first.unlock_local_session(STRONG)
            first._cookies = dict(COOKIES)
            first._request = lambda method, route, **kwargs: verified()
            self.assertTrue(gateway.verified_account_session_reply(first.session())["authenticated"])
            self.assertTrue(Path(path).is_file())
            second = client()
            self.assertEqual(second._cookies, {})
            second.unlock_local_session(STRONG)
            self.assertEqual(second._cookies, COOKIES)
            second._request = lambda method, route, **kwargs: gateway.GatewayReply(
                status=204, headers={}, body=b"")
            second.logout()
            self.assertFalse(Path(path).exists())
            third = client()
            third.unlock_local_session(STRONG)
            self.assertEqual(third._cookies, {})

    def test_failed_local_unlock_preserves_vault_for_recovery(self):
        """A wrong vault passphrase is not user-authorized account logout."""
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "old.json")
            path = Path(directory) / "account" / "session.vault"

            def client():
                return gateway.NativeAccountGateway(
                    ORIGIN, legacy, hot_session_store=NoHotSession(),
                    vault_path=str(path))

            first = client()
            first.unlock_local_session(STRONG)
            first._cookies = dict(COOKIES)
            first._request = lambda *_args, **_kwargs: verified()
            first.session()
            saved = path.read_bytes()

            wrong = client()
            wrong.unlock_local_session("another-long-device-password")
            self.assertEqual(wrong._cookies, {})
            self.assertEqual(path.read_bytes(), saved)

            # The original encrypted refresh session is still recoverable.
            restored = client()
            restored.unlock_local_session(STRONG)
            self.assertEqual(restored._cookies, COOKIES)

    def test_tampered_vault_is_not_erased_or_treated_as_authenticated(self):
        """A corrupt vault must remain intact for diagnostics and recovery."""
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "old.json")
            path = Path(directory) / "account" / "session.vault"
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(),
                vault_path=str(path))
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._request = lambda *_args, **_kwargs: verified()
            account.session()
            value = json.loads(path.read_text(encoding="utf-8"))
            value["nonce"] = "AAAAAAAAAAAAAAAA"
            path.write_text(json.dumps(value), encoding="utf-8")
            tampered = path.read_bytes()

            rebooted = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(),
                vault_path=str(path))
            rebooted.unlock_local_session(STRONG)
            self.assertEqual(rebooted._cookies, {})
            self.assertEqual(path.read_bytes(), tampered)

    def test_symlink_vault_failure_does_not_destroy_unrelated_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.joinpath("account").mkdir(mode=0o700)
            target = root / "other.txt"
            target.write_text("keep other data intact", encoding="utf-8")
            path = root / "account" / "session.vault"
            path.symlink_to(target)
            account = gateway.NativeAccountGateway(
                ORIGIN, str(root / "legacy.json"),
                hot_session_store=NoHotSession(), vault_path=str(path))
            account.unlock_local_session(STRONG)
            self.assertEqual(account._cookies, {})
            self.assertTrue(path.is_symlink())
            self.assertEqual(target.read_text(encoding="utf-8"), "keep other data intact")

    def test_explicit_logout_purges_vault_even_if_remote_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "old.json")
            path = str(Path(directory) / "account" / "session.vault")
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._request = lambda *_args, **_kwargs: verified()
            account.session()
            self.assertTrue(Path(path).exists())

            def offline(*_args, **_kwargs):
                raise gateway.NativeAccountGatewayError("gateway-unreachable")
            account._request = offline
            with self.assertRaises(gateway.NativeAccountGatewayError):
                account.logout()
            self.assertEqual(account._cookies, {})
            self.assertFalse(Path(path).exists())

    def test_anonymous_gateway_revalidation_revokes_saved_session(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "old.json")
            path = str(Path(directory) / "account" / "session.vault")
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._request = lambda *_args, **_kwargs: verified()
            account.session()
            self.assertTrue(Path(path).exists())
            account._request = lambda *_args, **_kwargs: gateway.GatewayReply(
                status=200, headers={},
                body=json.dumps({
                    "$schema": gateway.SESSION_SCHEMA,
                    "authenticated": False, "status": "anonymous",
                    "provider": "supabase",
                }).encode(),
            )
            account.session()
            self.assertFalse(Path(path).exists())

    def test_gateway_refresh_rotation_persists_latest_cookies_across_reboot(self):
        """A server-confirmed refresh must replace the saved token, not just RAM."""
        from email.message import Message
        from io import BytesIO

        class Response(BytesIO):
            status = 200

            def __init__(self):
                super().__init__(verified().body)
                self.headers = Message()
                self.headers.add_header("Set-Cookie", "ordax_access=rotated.access; Path=/; HttpOnly")
                self.headers.add_header("Set-Cookie", "ordax_refresh=rotated.refresh; Path=/; HttpOnly")

        class Opener:
            def open(self, request, timeout):
                assert request.full_url.endswith("/auth/session")
                assert request.get_header("Cookie") == (
                    "ordax_access=signed.access; ordax_refresh=signed.refresh"
                )
                return Response()

        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "legacy.json")
            path = str(Path(directory) / "account" / "session.vault")
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._opener = Opener()
            self.assertTrue(gateway.verified_account_session_reply(account.session())["authenticated"])
            self.assertEqual(account._cookies["ordax_refresh"], "rotated.refresh")

            rebooted = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            rebooted.unlock_local_session(STRONG)
            self.assertEqual(rebooted._cookies, {
                "ordax_access": "rotated.access",
                "ordax_refresh": "rotated.refresh",
            })

    def test_gateway_outage_preserves_vault_for_later_revalidation(self):
        """Network loss is not logout and must not destroy the last safe snapshot."""
        from urllib.error import URLError

        class OfflineOpener:
            def open(self, request, timeout):
                raise URLError("offline")

        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "legacy.json")
            path = str(Path(directory) / "account" / "session.vault")
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._request = lambda *_args, **_kwargs: verified()
            account.session()
            saved = Path(path).read_bytes()
            account._request = gateway.NativeAccountGateway._request.__get__(account)
            account._opener = OfflineOpener()
            with self.assertRaises(gateway.NativeAccountGatewayError):
                account.session()
            self.assertEqual(Path(path).read_bytes(), saved)

            rebooted = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            rebooted.unlock_local_session(STRONG)
            self.assertEqual(rebooted._cookies, COOKIES)

    def test_confirmed_account_close_clears_same_canonical_session_as_logout(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = str(Path(directory) / "legacy.json")
            path = str(Path(directory) / "account" / "session.vault")
            account = gateway.NativeAccountGateway(
                ORIGIN, legacy, hot_session_store=NoHotSession(), vault_path=path)
            account.unlock_local_session(STRONG)
            account._cookies = dict(COOKIES)
            account._request = lambda *_args, **_kwargs: verified()
            account.session()
            self.assertTrue(Path(path).is_file())

            account._request = lambda *_args, **_kwargs: gateway.GatewayReply(
                status=409, headers={}, body=b'{"closed":false}')
            self.assertEqual(account.close_account("password", "close-account").status, 409)
            self.assertTrue(Path(path).is_file())
            self.assertEqual(account._cookies, COOKIES)

            # A 200 transport response alone cannot authorize credential teardown.
            account._request = lambda *_args, **_kwargs: gateway.GatewayReply(
                status=200, headers={}, body=b'{"closed":false}')
            self.assertEqual(account.close_account("password", "close-account").status, 200)
            self.assertTrue(Path(path).is_file())
            self.assertEqual(account._cookies, COOKIES)

            account._request = lambda *_args, **_kwargs: gateway.GatewayReply(
                status=200, headers={}, body=b'{"closed":true}')
            self.assertEqual(account.close_account("password", "close-account").status, 200)
            self.assertFalse(Path(path).exists())
            self.assertEqual(account._cookies, {})

    def test_native_host_uses_only_existing_local_secret_and_gateway(self):
        host = (RUNTIME / "native_host_server.py").read_text(encoding="utf-8")
        self.assertIn("vault_path=ACCOUNT_VAULT_FILE", host)
        self.assertIn("self.server.account_gateway.unlock_local_session(secret)", host)
        self.assertIn("self.server.account_gateway.clear_local_session_vault()", host)
        self.assertIn("if self.server.local_session_locked:\n                self._empty(423)", host)
        surface = (ROOT / "system" / "composition" / "native" / "main.mjs").read_text(encoding="utf-8")
        self.assertNotIn("session.vault", surface)


if __name__ == "__main__":
    unittest.main()
