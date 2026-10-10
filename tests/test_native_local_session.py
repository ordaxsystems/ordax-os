import importlib.util
import http.client
import json
import os
from pathlib import Path
import threading
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system/surface/runtime/native_host_server.py"
ADAPTER = ROOT / "system/adapters/native/local-session.mjs"
CONTRACT = ROOT / "system/contracts/local-session.mjs"
COMPOSITION = ROOT / "system/composition/native/main.mjs"
FIRST_RUN = ROOT / "system/surface/ui/first-run.mjs"
SETTINGS = ROOT / "system/surface/ui/settings-overview-controls.mjs"
SETTINGS_I18N = ROOT / "system/services/i18n/catalog/settings.mjs"
LOCK = ROOT / "system" / "surface" / "ui" / "local-session-lock.mjs"
LOCAL_SESSION_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "local-session.mjs"

spec = importlib.util.spec_from_file_location("ordax_native_local_session_test", HOST)
host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(host)


class NativeLocalSessionTests(unittest.TestCase):
    def setUp(self):
        self.original_credential_file = host.LOCAL_SESSION_CREDENTIAL_FILE
        self.tempdir = tempfile.TemporaryDirectory()
        host.LOCAL_SESSION_CREDENTIAL_FILE = str(Path(self.tempdir.name) / "local-session-credential.json")

    def tearDown(self):
        host.LOCAL_SESSION_CREDENTIAL_FILE = self.original_credential_file
        self.tempdir.cleanup()

    def test_scrypt_credential_is_atomic_private_and_never_plaintext(self):
        secret = "local-passphrase-42"
        host.write_local_session_credential(secret)
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        self.assertTrue(path.is_file())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        raw = path.read_text(encoding="utf-8")
        self.assertNotIn(secret, raw)
        payload = json.loads(raw)
        self.assertEqual(payload["schema"], "ordax.local-session-credential/1")
        self.assertEqual(payload["kdf"], "scrypt")
        self.assertEqual(payload["n"], 1 << 15)
        self.assertEqual(payload["r"], 8)
        self.assertEqual(payload["p"], 1)
        self.assertRegex(payload["saltHex"], r"^[0-9a-f]{64}$")
        self.assertRegex(payload["verifierHex"], r"^[0-9a-f]{64}$")
        self.assertTrue(host.verify_local_session_secret(secret))
        self.assertFalse(host.verify_local_session_secret("wrong-secret"))

    def test_credential_presence_means_new_host_session_starts_locked(self):
        host.write_local_session_credential("local-passphrase-42")
        server = SimpleNamespace(local_session_locked=True)
        snapshot = host.local_session_snapshot(server)
        self.assertEqual(snapshot["schema"], "ordax.local-session/1")
        self.assertEqual(snapshot["state"], "locked")
        self.assertTrue(snapshot["credentialConfigured"])
        self.assertTrue(snapshot["canLock"])
        self.assertEqual(
            snapshot["protectionScope"],
            "surface-session-not-storage-encryption",
        )

    def test_malformed_credential_presence_still_keeps_new_session_locked(self):
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        path.write_text('{"schema":"corrupt"}\n', encoding="utf-8")
        server = SimpleNamespace(local_session_locked=True)
        snapshot = host.local_session_snapshot(server)
        self.assertEqual(snapshot["state"], "locked")
        self.assertTrue(snapshot["credentialConfigured"])
        with self.assertRaises(ValueError):
            host.read_local_session_credential()

    def test_removing_credential_returns_session_to_unlocked_non_lockable_state(self):
        host.write_local_session_credential("local-passphrase-42")
        host.remove_local_session_credential()
        server = SimpleNamespace(local_session_locked=False)
        snapshot = host.local_session_snapshot(server)
        self.assertEqual(snapshot["state"], "unlocked")
        self.assertFalse(snapshot["credentialConfigured"])
        self.assertFalse(snapshot["canLock"])

    @unittest.skipUnless(os.name == "posix", "Credential file safety requires POSIX")
    def test_unsafe_credential_entries_never_authenticate(self):
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        for case in ("symbolic-link", "hard-link", "directory", "fifo", "public-mode", "oversized", "invalid-utf8"):
            with self.subTest(case=case):
                host.write_local_session_credential("local-passphrase-42")
                target = path.with_name("other-credential")
                if case in ("symbolic-link", "hard-link"):
                    target.write_bytes(path.read_bytes())
                    target.chmod(0o600)
                    path.unlink()
                    if case == "symbolic-link":
                        path.symlink_to(target)
                    else:
                        os.link(target, path)
                elif case == "directory":
                    path.unlink()
                    path.mkdir()
                elif case == "fifo":
                    path.unlink()
                    os.mkfifo(path, 0o600)
                elif case == "public-mode":
                    path.chmod(0o644)
                elif case == "oversized":
                    path.write_bytes(path.read_bytes() + b" " * host.MAX_LOCAL_SESSION_CREDENTIAL_BYTES)
                elif case == "invalid-utf8":
                    path.write_bytes(b"\xff\xfe")
                self.assertTrue(host.local_session_credential_present())
                with self.assertRaises(ValueError):
                    host.verify_local_session_secret("local-passphrase-42")
                if path.is_dir():
                    path.rmdir()
                else:
                    path.unlink()

    def test_unreadable_credential_cannot_establish_absence(self):
        with patch.object(host.os, "lstat", side_effect=PermissionError("denied")):
            self.assertTrue(host.local_session_credential_present())
            with self.assertRaises(ValueError):
                host.read_local_session_credential()

    def test_lost_credential_cannot_unlock_live_session(self):
        host.write_local_session_credential("local-passphrase-42")
        state = SimpleNamespace(local_session_locked=True)
        Path(host.LOCAL_SESSION_CREDENTIAL_FILE).unlink()
        snapshot = host.local_session_snapshot(state)
        self.assertTrue(state.local_session_locked)
        self.assertEqual(snapshot["state"], "locked")
        self.assertTrue(snapshot["credentialConfigured"])

    @unittest.skipUnless(os.name == "posix", "Native HTTP session test requires Linux")
    def test_http_snapshot_does_not_unlock_after_credential_loss(self):
        host.write_local_session_credential("local-passphrase-42")
        server = host.NativeHostServer(
            ("127.0.0.1", 0), host.NativeHostHandler,
            user_root=self.tempdir.name,
            power_request_path=str(Path(self.tempdir.name) / "power-request"),
            network_session_dir=self.tempdir.name,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=2)))
        self.assertTrue(server.local_session_locked)
        Path(host.LOCAL_SESSION_CREDENTIAL_FILE).unlink()
        connection = http.client.HTTPConnection(*server.server_address, timeout=2)
        try:
            connection.request("GET", host.LOCAL_SESSION_PATH)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            snapshot = json.loads(response.read())
            self.assertEqual(snapshot["state"], "locked")
            self.assertTrue(snapshot["credentialConfigured"])
            self.assertTrue(server.local_session_locked)
        finally:
            connection.close()

    def test_machine_readable_credential_safety_matches_host(self):
        policy = json.loads((ROOT / "docs/contracts/local-session.json").read_text(encoding="utf-8"))
        self.assertEqual(policy["credential"]["maximum_file_bytes"], host.MAX_LOCAL_SESSION_CREDENTIAL_BYTES)
        for property_name in (
            "symbolic_links_allowed",
            "hard_links_allowed",
            "non_regular_entries_allowed",
            "missing_or_corrupt_credential_may_unlock_active_session",
        ):
            self.assertFalse(policy["credential"][property_name])
        self.assertEqual(policy["credential"]["file_mode"], "0600")

    def test_native_http_boundary_is_loopback_and_rate_limited(self):
        text = HOST.read_text(encoding="utf-8")
        self.assertIn('LOCAL_SESSION_PATH = "/__ordax/native/local-session"', text)
        self.assertIn('LOCAL_SESSION_CREDENTIAL_FILE = "/var/lib/ordax/local-session-credential.json"', text)
        self.assertIn("hashlib.scrypt(", text)
        self.assertIn("hmac.compare_digest(actual, expected)", text)
        self.assertIn("self.local_session_retry_after", text)
        self.assertIn("self._empty(429)", text)
        get_section = text.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        self.assertIn("LOCAL_SESSION_PATH", get_section)
        post_section = text.split("def do_POST", 1)[1]
        self.assertIn("parsed_path == LOCAL_SESSION_PATH", post_section)
        self.assertNotIn("LOCAL_SESSION_CREDENTIAL_FILE", FIRST_RUN.read_text(encoding="utf-8"))

    def test_product_wiring_keeps_local_session_separate_from_online_identity(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        first_run = FIRST_RUN.read_text(encoding="utf-8")
        settings = SETTINGS.read_text(encoding="utf-8")
        settings_i18n = SETTINGS_I18N.read_text(encoding="utf-8")
        lock = LOCK.read_text(encoding="utf-8")
        local_session_i18n = LOCAL_SESSION_I18N.read_text(encoding="utf-8")
        self.assertIn('LOCAL_SESSION_SCHEMA = "ordax.local-session/1"', contract)
        self.assertIn('"/__ordax/native/local-session"', adapter)
        self.assertIn("createNativeLocalSession", composition)
        self.assertIn("mountLocalSessionLock(root, localSession, surface)", composition)
        self.assertIn("assertSurfaceRenderLifecycle", lock)
        self.assertIn("localization.subscribe", lock)
        self.assertIn("unsubscribeLocalization", lock)
        self.assertIn('"localSession.lock.message.rateLimited"', lock)
        self.assertIn('t("localSession.lock.title")', lock)
        self.assertIn('"localSession.lock.title": "Session locked"', local_session_i18n)
        self.assertIn('"localSession.lock.action.unlock": "Unlock"', local_session_i18n)
        self.assertNotIn('"Sessão bloqueada"', lock)
        self.assertNotIn('"PIN ou senha local incorreto."', lock)
        self.assertIn('"security"', first_run)
        self.assertIn("localSessionPort.configureCredential", first_run)
        self.assertIn('messageId: "settings.section.security"', settings)
        self.assertIn('"settings.section.security": "Segurança"', settings_i18n)
        self.assertIn('"settings.security.title": "Lock this OrdaX"', settings_i18n)
        self.assertIn('"settings.security.message.incorrect": "Incorrect local PIN or password."', settings_i18n)
        self.assertIn('t("settings.security.title")', settings)
        self.assertIn('t(localSessionMessageId)', settings)
        self.assertNotIn('"Bloqueio deste OrdaX"', settings)
        self.assertNotIn('"PIN ou senha local incorreto."', settings)
        self.assertNotIn("supabase", adapter.lower())
        self.assertNotIn("identity-session", adapter)
        self.assertNotIn("account", contract.lower())


if __name__ == "__main__":
    unittest.main()
