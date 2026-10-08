"""End-to-end Native Host bridge regression with a fake local inference daemon."""

from __future__ import annotations

import http.client
import importlib.util
import json
import os
import socket
import time
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = ROOT / "system/surface/runtime/native_host_server.py"
spec = importlib.util.spec_from_file_location("ordax_native_local_ai_host_test", HOST_PATH)
host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(host)
import native_local_ai_bridge as bridge  # noqa: E402


class FakeBackend(BaseHTTPRequestHandler):
    def authorized(self):
        return self.headers.get("Authorization") == "Bearer " + self.server.expected_key

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, b'{"status":"ok"}')
        elif self.path == "/v1/models":
            if not self.authorized():
                self.respond(401, b'')
                return
            self.respond(200, b'{"data":[{"id":"test-model"}]}')
        else:
            self.respond(404, b"")

    def do_POST(self):
        if not self.authorized():
            self.respond(401, b"")
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length)
        self.server.received.append((self.path, payload))
        self.respond(200, b'{"model":"test-model","choices":[{"message":{"content":"ok"}}]}')

    def respond(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


class NativeLocalAiBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.backend = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
        self.backend.received = []
        self.backend.expected_key = "ab" * 32
        self.real_auth_file = bridge.AUTH_FILE
        root = Path(self.temp.name)
        key_path = root / "local-ai-key"
        key_path.write_text(self.backend.expected_key + "\n", encoding="ascii")
        key_path.chmod(0o600)
        bridge.AUTH_FILE = str(key_path)
        self.auth_path = key_path
        self.real_upstream_port = bridge.UPSTREAM_PORT
        bridge.UPSTREAM_PORT = self.backend.server_address[1]
        self.backend_thread = threading.Thread(target=self.backend.serve_forever, daemon=True)
        self.backend_thread.start()
        root = Path(self.temp.name)
        (root / "index.html").write_text("<title>OrdaX</title>", encoding="utf-8")
        self.native = host.NativeHostServer(
            ("127.0.0.1", 0),
            partial(host.NativeHostHandler, directory=str(root)),
            user_root=str(root),
            power_request_path=str(root / "power-request"),
            network_session_dir=str(root),
        )
        self.native.local_session_locked = False
        self.native_thread = threading.Thread(target=self.native.serve_forever, daemon=True)
        self.native_thread.start()
        self.port = self.native.server_address[1]

    def tearDown(self):
        self.native.shutdown()
        self.native.server_close()
        self.native_thread.join(timeout=2)
        self.backend.shutdown()
        self.backend.server_close()
        self.backend_thread.join(timeout=2)
        bridge.UPSTREAM_PORT = self.real_upstream_port
        bridge.AUTH_FILE = self.real_auth_file
        self.temp.cleanup()

    def request(self, method, path, *, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            result = conn.getresponse()
            return result.status, result.read(), dict(result.getheaders())
        finally:
            conn.close()

    @staticmethod
    def completion(*, extra=None):
        data = {
            "model": "test-model",
            "messages": [{"role": "user", "content": "ola"}],
            "max_tokens": 24,
            "stream": False,
        }
        data.update(extra or {})
        return json.dumps(data).encode()

    def test_same_origin_health_discovery_and_inference(self):
        endpoint = bridge.NATIVE_LOCAL_AI_PREFIX
        origin = f"http://127.0.0.1:{self.port}"
        headers = {"Origin": origin, "Sec-Fetch-Site": "same-origin"}
        status, body, _ = self.request("GET", endpoint + "/health", headers=headers)
        self.assertEqual((status, body), (200, b""))
        status, body, _ = self.request("GET", endpoint + "/v1/models", headers=headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["data"][0]["id"], "test-model")
        status, body, response_headers = self.request(
            "POST", endpoint + "/v1/chat/completions", body=self.completion(),
            headers={**headers, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["model"], "test-model")
        self.assertNotIn("Access-Control-Allow-Origin", response_headers)
        self.assertEqual(len(self.backend.received), 1)

    def test_foreign_origin_and_dns_rebinding_are_rejected_before_upstream(self):
        endpoint = bridge.NATIVE_LOCAL_AI_PREFIX
        for headers in (
            {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"},
            {"Host": f"evil.example:{self.port}"},
        ):
            status, _, _ = self.request("GET", endpoint + "/v1/models", headers=headers)
            self.assertEqual(status, 403)
        status, _, _ = self.request(
            "POST", endpoint + "/v1/chat/completions",
            headers={"Origin": "https://evil.example", "Content-Type": "application/json"},
            body=self.completion(),
        )
        self.assertEqual(status, 403)
        self.assertEqual(self.backend.received, [])

    def test_session_lock_blocks_inference_but_not_readiness_and_recovers_on_unlock(self):
        self.native.local_session_locked = True
        for suffix in ("/health", "/v1/models"):
            status, _, _ = self.request("GET", bridge.NATIVE_LOCAL_AI_PREFIX + suffix)
            self.assertEqual(status, 200)
        path = bridge.NATIVE_LOCAL_AI_PREFIX + "/v1/chat/completions"
        status, _, _ = self.request(
            "POST", path, body=self.completion(),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(status, 423)
        self.assertEqual(self.backend.received, [])
        self.native.local_session_locked = False
        status, _, _ = self.request(
            "POST", path, body=self.completion(),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(self.backend.received), 1)

    def test_no_arbitrary_routes_queries_tools_or_stream(self):
        prefix = bridge.NATIVE_LOCAL_AI_PREFIX
        for path in (prefix + "/v1/embeddings", prefix + "/v1/chat/completions?model=override"):
            status, _, _ = self.request("POST", path, body=self.completion(), headers={"Content-Type": "application/json"})
            self.assertIn(status, (400, 404))
        for extra in ({"tools": []}, {"stream": True}, {"max_tokens": 4096}):
            status, _, _ = self.request(
                "POST", prefix + "/v1/chat/completions",
                body=self.completion(extra=extra),
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(status, 400)
        self.assertEqual(self.backend.received, [])

    def test_missing_or_unsafe_secret_fails_closed_before_forwarding(self):
        path = bridge.NATIVE_LOCAL_AI_PREFIX + "/v1/chat/completions"
        good_body = self.completion()
        for change in ("missing", "world-readable", "wrong-length", "symlink"):
            with self.subTest(change=change):
                if self.auth_path.exists() or self.auth_path.is_symlink():
                    self.auth_path.unlink()
                if change == "missing":
                    pass
                elif change == "symlink":
                    other = self.auth_path.parent / "other-secret"
                    other.write_text(self.backend.expected_key + "\n", encoding="ascii")
                    other.chmod(0o600)
                    self.auth_path.symlink_to(other)
                else:
                    self.auth_path.write_text(
                        self.backend.expected_key + ("\n" if change != "wrong-length" else ""),
                        encoding="ascii",
                    )
                    self.auth_path.chmod(0o644 if change == "world-readable" else 0o600)
                status, _, _ = self.request(
                    "POST", path, body=good_body, headers={"Content-Type": "application/json"},
                )
                self.assertEqual(status, 503)
        self.assertEqual(self.backend.received, [])

    def test_incomplete_completion_body_expires_before_backend(self):
        """A valid length must not pin a Native Host thread indefinitely."""
        old_deadline = host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS
        host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS = 0.2
        try:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
            try:
                connection.request(
                    "POST", bridge.NATIVE_LOCAL_AI_PREFIX + "/v1/chat/completions",
                    body=b"{", headers={
                        "Content-Type": "application/json",
                        "Content-Length": "128",
                    },
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 408)
                self.assertEqual(response.read(), b"")
                self.assertEqual(self.backend.received, [])
            finally:
                connection.close()
        finally:
            host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS = old_deadline

    def test_trickling_body_cannot_extend_absolute_deadline(self):
        old_deadline = host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS
        host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS = 0.2
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
                client.settimeout(2)
                client.sendall((
                    f"POST {bridge.NATIVE_LOCAL_AI_PREFIX}/v1/chat/completions HTTP/1.1\\r\\n"
                    f"Host: 127.0.0.1:{self.port}\\r\\n"
                    "Content-Type: application/json\\r\\n"
                    "Content-Length: 128\\r\\nConnection: close\\r\\n\\r\\n"
                ).encode("ascii") + b"{")
                time.sleep(0.1)
                client.sendall(b'"')
                # A steady trickle cannot reset a full-request deadline.
                response = bytearray()
                while b"\\r\\n" not in response:
                    block = client.recv(1024)
                    if not block:
                        break
                    response.extend(block)
                self.assertIn(b" 408 ", bytes(response).split(b"\\r\\n", 1)[0])
                self.assertEqual(self.backend.received, [])
        finally:
            host.LOCAL_AI_BODY_READ_TIMEOUT_SECONDS = old_deadline

    def test_byte_cap_and_unsupported_content_type(self):
        path = bridge.NATIVE_LOCAL_AI_PREFIX + "/v1/chat/completions"
        status, _, _ = self.request(
            "POST", path, body=b"x" * (bridge.MAX_REQUEST_BYTES + 1),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(status, 413)
        status, _, _ = self.request(
            "POST", path, body=self.completion(), headers={"Content-Type": "text/plain"},
        )
        self.assertEqual(status, 415)
        self.assertEqual(self.backend.received, [])

    def test_contract_and_implementation_share_native_path(self):
        contract = json.loads((ROOT / "docs/contracts/local-ai.json").read_text(encoding="utf-8"))
        js = (ROOT / "system/contracts/local-ai.mjs").read_text(encoding="utf-8")
        self.assertEqual(contract["runtime"]["native_same_origin_endpoint"], bridge.NATIVE_LOCAL_AI_PREFIX)
        self.assertIn(f'LOCAL_AI_NATIVE_ENDPOINT = "{bridge.NATIVE_LOCAL_AI_PREFIX}"', js)
        self.assertEqual(set(contract["runtime"]["native_bridge_paths"]), {
            "GET /health", "GET /v1/models", "POST /v1/chat/completions",
        })


if __name__ == "__main__":
    unittest.main()
