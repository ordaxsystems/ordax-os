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

    @unittest.skipUnless(os.name == "posix", "Native credential filesystem policy requires POSIX")
    def test_unsafe_credential_entries_are_present_but_never_authenticate(self):
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        for kind in ("symlink", "dangling-symlink", "directory", "fifo", "hard-link", "public-mode", "oversized", "invalid-utf8"):
            with self.subTest(kind=kind):
                host.write_local_session_credential("local-passphrase-42")
                original = path.read_bytes()
                if kind in {"symlink", "dangling-symlink", "hard-link"}:
                    target = path.with_name("target-" + kind)
                    if kind != "dangling-symlink":
                        target.write_bytes(original)
                        target.chmod(0o600)
                    path.unlink()
                    if kind == "hard-link":
                        os.link(target, path)
                    else:
                        path.symlink_to(target)
                elif kind == "directory":
                    path.unlink()
                    path.mkdir()
                elif kind == "fifo":
                    path.unlink()
                    os.mkfifo(path, 0o600)
                elif kind == "public-mode":
                    path.chmod(0o644)
                elif kind == "oversized":
                    path.write_bytes(original + b" " * host.MAX_LOCAL_SESSION_CREDENTIAL_BYTES)
                elif kind == "invalid-utf8":
                    path.write_bytes(b"\xff\xfe")

                self.assertTrue(host.local_session_credential_present())
                snapshot = host.local_session_snapshot(SimpleNamespace(local_session_locked=True))
                self.assertEqual(snapshot["state"], "locked")
                with self.assertRaises(ValueError):
                    host.verify_local_session_secret("local-passphrase-42")
                if path.is_dir():
                    path.rmdir()
                else:
                    path.unlink()

    def test_unreadable_credential_path_cannot_establish_absence(self):
        with patch.object(host.os, "lstat", side_effect=PermissionError("unreadable")):
            self.assertTrue(host.local_session_credential_present())
            with self.assertRaises(ValueError):
                host.read_local_session_credential()

    @unittest.skipUnless(os.name == "posix", "Native credential descriptor policy requires POSIX")
    def test_replacement_between_presence_check_and_open_fails_closed(self):
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        host.write_local_session_credential("local-passphrase-42")
        target = path.with_name("replacement")
        target.write_bytes(path.read_bytes())
        target.chmod(0o600)
        original_open = os.open

        def replace_on_open(filename, flags, *args, **kwargs):
            if filename == str(path):
                path.unlink()
                path.symlink_to(target)
            return original_open(filename, flags, *args, **kwargs)

        with patch.object(host.os, "open", side_effect=replace_on_open):
            with self.assertRaises(ValueError):
                host.verify_local_session_secret("local-passphrase-42")

    def start_server(self):
        server = host.NativeHostServer(
            ("127.0.0.1", 0),
            host.NativeHostHandler,
            user_root=self.tempdir.name,
            power_request_path=str(Path(self.tempdir.name) / "power-request"),
            network_session_dir=self.tempdir.name,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop():
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.addCleanup(stop)
        return server

    def request(self, server, payload=None):
        connection = http.client.HTTPConnection(*server.server_address, timeout=2)
        self.addCleanup(connection.close)
        headers = {"Origin": f"http://127.0.0.1:{server.server_address[1]}"}
        if payload is None:
            connection.request("GET", host.LOCAL_SESSION_PATH, headers=headers)
        else:
            headers["Content-Type"] = "application/json"
            connection.request("POST", host.LOCAL_SESSION_PATH, body=json.dumps(payload), headers=headers)
        response = connection.getresponse()
        body = response.read()
        return response.status, json.loads(body) if body else None

    @unittest.skipUnless(os.name == "posix", "Native special entries require POSIX")
    def test_host_start_with_dangling_or_directory_credential_stays_locked(self):
        path = Path(host.LOCAL_SESSION_CREDENTIAL_FILE)
        path.symlink_to(path.with_name("absent-target"))
        server = self.start_server()
        self.assertTrue(server.local_session_locked)
        status, snapshot = self.request(server)
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["state"], "locked")
        status, _ = self.request(server, {"action": "configure-credential", "secret": "replacement-secret"})
        self.assertEqual(status, 503)
        self.assertTrue(path.is_symlink())
        path.unlink()
        path.mkdir()
        directory_server = self.start_server()
        self.assertTrue(directory_server.local_session_locked)
        status, snapshot = self.request(server)
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["state"], "locked")

    @unittest.skipUnless(os.name == "posix", "Native private credential requires POSIX")
    def test_live_credential_loss_does_not_unlock_or_allow_reconfiguration(self):
        host.write_local_session_credential("local-passphrase-42")
        server = self.start_server()
        Path(host.LOCAL_SESSION_CREDENTIAL_FILE).unlink()
        status, snapshot = self.request(server)
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["state"], "locked")
        self.assertTrue(snapshot["credentialConfigured"])
        self.assertTrue(server.local_session_locked)
        for action in ("unlock", "configure-credential"):
            status, _ = self.request(server, {"action": action, "secret": "replacement-secret"})
            self.assertEqual(status, 409)

    @unittest.skipUnless(os.name == "posix", "Native private credential requires POSIX")
    def test_verified_unlock_and_removal_are_still_available(self):
        secret = "local-passphrase-42"
        host.write_local_session_credential(secret)
        server = self.start_server()
        status, snapshot = self.request(server, {"action": "unlock", "secret": secret})
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["state"], "unlocked")
        status, snapshot = self.request(server, {"action": "remove-credential", "secret": secret})
        self.assertEqual(status, 200)
        self.assertFalse(snapshot["credentialConfigured"])
        self.assertEqual(snapshot["state"], "unlocked")

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

    def test_machine_readable_credential_policy_matches_native_bounds(self):
        policy = json.loads((ROOT / "docs/contracts/local-session.json").read_text(encoding="utf-8"))
        self.assertEqual(policy["credential"]["maximum_file_bytes"], host.MAX_LOCAL_SESSION_CREDENTIAL_BYTES)
        self.assertEqual(policy["credential"]["file_mode"], "0600")
        self.assertFalse(policy["credential"]["symbolic_links_allowed"])
        self.assertFalse(policy["credential"]["hard_links_allowed"])
        self.assertFalse(policy["credential"]["non_regular_entries_allowed"])

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
