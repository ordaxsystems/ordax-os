from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import socket
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_consent_ipc.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_consent_ipc_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def request_payload():
    return {
        "schema": "ordax.profile-human-consent-request/1",
        "requestId": "a" * 32,
        "permissionDiff": {
            "schema": "ordax.profile-permission-diff/1",
            "componentAdds": [],
            "componentRemovals": [],
            "authorityChanges": [],
            "requiresExplicitReview": True,
        },
        "permissionDiffSha256": "b" * 64,
        "expectedRevision": 4,
        "spaceId": "space-1",
        "spaceKind": "professional",
        "profile": {"slug": "developer", "version": 1},
        "issuedAt": 100,
        "expiresAt": 200,
    }


class NativeProfileConsentIpcTests(unittest.TestCase):
    def test_private_unix_socket_roundtrip(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            socket_path = str(Path(directory) / "consent.sock")
            server = module.ProfileConsentIpcServer(socket_path=socket_path)
            listener = server.open()
            mode = os.stat(socket_path).st_mode & 0o777
            self.assertEqual(mode, 0o600)

            def serve():
                connection, _ = listener.accept()
                with connection:
                    request = server.receive_request(connection)
                    server.send_decision(
                        connection,
                        {
                            "schema": "ordax.profile-human-consent-decision/1",
                            "requestId": request["requestId"],
                            "approved": True,
                        },
                        expected_request_id=request["requestId"],
                    )

            thread = threading.Thread(target=serve)
            thread.start()
            decision = module.request_native_decision(
                request_payload(),
                socket_path=socket_path,
                timeout_seconds=2,
            )
            thread.join(timeout=2)
            self.assertEqual(decision["approved"], True)
            server.close()
            self.assertFalse(Path(socket_path).exists())

    def test_decision_must_match_request(self):
        module = load_module()
        with self.assertRaisesRegex(PermissionError, "does not match"):
            module.validate_decision({
                "schema": "ordax.profile-human-consent-decision/1",
                "requestId": "c" * 32,
                "approved": True,
            }, expected_request_id="a" * 32)

        left, right = socket.socketpair()
        try:
            server = module.ProfileConsentIpcServer(socket_path="/tmp/not-opened.sock")
            with self.assertRaisesRegex(PermissionError, "does not match"):
                server.send_decision(
                    left,
                    {
                        "schema": "ordax.profile-human-consent-decision/1",
                        "requestId": "c" * 32,
                        "approved": True,
                    },
                    expected_request_id="a" * 32,
                )
        finally:
            left.close()
            right.close()

    def test_existing_non_socket_path_fails_closed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "consent.sock"
            socket_path.write_text("not-a-socket", encoding="utf-8")
            server = module.ProfileConsentIpcServer(socket_path=str(socket_path))
            with self.assertRaisesRegex(RuntimeError, "not a socket"):
                server.open()

    def test_message_size_is_bounded(self):
        module = load_module()
        payload = request_payload()
        payload["permissionDiff"]["padding"] = "x" * (module.MAX_MESSAGE_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "size"):
            module._encode(payload)


if __name__ == "__main__":
    unittest.main()
