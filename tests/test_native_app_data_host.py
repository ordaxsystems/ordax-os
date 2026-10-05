#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_app_data_host import (  # noqa: E402
    NativeAppDataHostHandler,
    NativeAppDataHostServer,
)
from native_app_install_identity import (  # noqa: E402
    canonical_verified_app_install_identity_bytes,
)


def receipt():
    return {
        "$schema": "ordax.verified-app-install-identity/1",
        "status": "verified",
        "publisherPrincipalId": "ordax-official",
        "appId": "notes",
        "ownerScope": "device",
        "sourceClass": "system-release-bundled",
        "sourceVersion": "0.4.1",
        "sourceDigest": "1" * 64,
        "verificationOwner": "release-acquisition",
        "verificationPolicy": "ordax.publisher-trust/1",
        "verificationGeneration": 1,
    }


class NativeAppDataHostHttpTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.static = self.temp / "static"
        self.static.mkdir()
        self.receipts = self.temp / "receipts"
        self.receipts.mkdir(mode=0o700)
        os.chmod(self.receipts, 0o700)
        self.data_root = self.temp / "app-data"
        self.user_root = self.temp / "user"
        self.session = self.temp / "session"
        self.session.mkdir()

        payload = canonical_verified_app_install_identity_bytes(receipt())
        self.digest = hashlib.sha256(payload).hexdigest()
        receipt_path = self.receipts / f"{self.digest}.json"
        receipt_path.write_bytes(payload)
        os.chmod(receipt_path, 0o600)

        handler = partial(NativeAppDataHostHandler, directory=str(self.static))
        self.server = NativeAppDataHostServer(
            ("127.0.0.1", 0),
            handler,
            user_root=str(self.user_root),
            power_request_path=str(self.temp / "missing-power-fifo"),
            network_session_dir=str(self.session),
            product_mode="usb",
            distribution_profile="owner-development",
            native_install_capability="disabled",
            component_channel_bin=str(self.temp / "missing-component-helper"),
            component_trust_path=str(self.temp / "missing-component-trust.json"),
            component_slot_root=str(self.temp / "components"),
            account_gateway_origin="",
            app_data_receipt_root=str(self.receipts),
            app_data_expected_uid=os.getuid(),
            app_data_root=str(self.data_root),
        )
        self.binding = self.server.bind_app_data_receipt(self.digest)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.temporary.cleanup()

    def make_deferred_server(self):
        handler = partial(NativeAppDataHostHandler, directory=str(self.static))
        return NativeAppDataHostServer(
            ("127.0.0.1", 0),
            handler,
            user_root=str(self.user_root),
            power_request_path=str(self.temp / "missing-power-fifo"),
            network_session_dir=str(self.session),
            product_mode="usb",
            distribution_profile="owner-development",
            native_install_capability="disabled",
            component_channel_bin=str(self.temp / "missing-component-helper"),
            component_trust_path=str(self.temp / "missing-component-trust.json"),
            component_slot_root=str(self.temp / "deferred-components"),
            account_gateway_origin="",
            app_data_receipt_root=str(self.receipts),
            app_data_expected_uid=os.getuid(),
            app_data_root=str(self.temp / "deferred-app-data"),
            app_data_defer_listener_activation=True,
        )

    def request(
        self,
        method: str,
        target: str,
        *,
        body: bytes | None = None,
        origin: str | None = None,
        content_type: str | None = None,
        content_length: int | None = None,
        extra_headers: dict[str, str] | None = None,
    ):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.putrequest(method, target, skip_host=True, skip_accept_encoding=True)
        connection.putheader("Host", f"127.0.0.1:{self.port}")
        connection.putheader("Origin", self.origin if origin is None else origin)
        connection.putheader("Sec-Fetch-Site", "same-origin")
        if content_type is not None:
            connection.putheader("Content-Type", content_type)
        if content_length is not None:
            connection.putheader("Content-Length", str(content_length))
        elif body is not None:
            connection.putheader("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers.items():
                connection.putheader(key, value)
        connection.endheaders(body)
        response = connection.getresponse()
        payload = response.read()
        headers = dict(response.getheaders())
        status = response.status
        connection.close()
        return status, headers, payload

    def json_post(self, target: str, value: dict, **kwargs):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        status, headers, payload = self.request(
            "POST",
            target,
            body=body,
            content_type="application/json",
            **kwargs,
        )
        decoded = json.loads(payload.decode("utf-8")) if payload else None
        return status, headers, decoded

    def test_deferred_listener_is_not_tcp_ready_before_explicit_activation(self):
        server = self.make_deferred_server()
        port = server.server_address[1]
        try:
            with self.assertRaises(OSError):
                connection = socket.create_connection(("127.0.0.1", port), timeout=0.2)
                connection.close()

            server.activate_private_listener()
            connection = socket.create_connection(("127.0.0.1", port), timeout=1)
            connection.close()
            with self.assertRaises(RuntimeError):
                server.activate_private_listener()
        finally:
            server.server_close()

    def test_bound_route_persists_and_cas_conflict_reports_actual_revision(self):
        status, _headers, stored = self.json_post(
            self.binding.endpoint,
            {
                "action": "put",
                "key": "note.alpha.0",
                "valueBase64": "b25l",
                "expectedRevision": 0,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(stored, {"revision": 1, "stored": True})

        status, _headers, listing = self.json_post(
            self.binding.endpoint,
            {"action": "list"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(listing["revision"], 1)
        self.assertEqual(listing["keys"], ["note.alpha.0"])

        status, _headers, conflict = self.json_post(
            self.binding.endpoint,
            {
                "action": "put",
                "key": "note.beta.0",
                "valueBase64": "dHdv",
                "expectedRevision": 0,
            },
        )
        self.assertEqual(status, 409)
        self.assertEqual(conflict["actualRevision"], 1)
        self.assertIn("revision conflict", conflict["error"])

    def test_identity_in_body_cannot_retarget_binding(self):
        status, _headers, reply = self.json_post(
            self.binding.endpoint,
            {"action": "list", "publisherId": "other"},
        )
        self.assertEqual(status, 400)
        self.assertIn("may not self-assert identity", reply["error"])

    def test_unknown_capability_is_rejected_before_body_policy(self):
        unknown = "/__ordax/native/app-data/" + "z" * 43
        status, _headers, reply = self.request(
            "POST",
            unknown,
            body=b"",
            content_type="text/plain",
            content_length=0,
        )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(reply.decode("utf-8"))["error"], "Native App Data capability is unknown")

    def test_route_rejects_foreign_origin_queries_and_non_post_methods(self):
        status, _headers, _reply = self.json_post(
            self.binding.endpoint,
            {"action": "list"},
            origin="https://evil.example",
        )
        self.assertEqual(status, 403)

        status, _headers, reply = self.json_post(
            self.binding.endpoint + "?appId=notes",
            {"action": "list"},
        )
        self.assertEqual(status, 400)
        self.assertIn("does not accept a query", reply["error"])

        status, _headers, payload = self.request("GET", self.binding.endpoint)
        self.assertEqual(status, 405)
        self.assertEqual(payload, b"")

        status, _headers, payload = self.request("HEAD", self.binding.endpoint)
        self.assertEqual(status, 405)
        self.assertEqual(payload, b"")

    def test_body_bounds_and_media_type_fail_closed(self):
        status, _headers, reply = self.request(
            "POST",
            self.binding.endpoint,
            body=b"{}",
            content_type="text/plain",
        )
        self.assertEqual(status, 415)
        self.assertIn("application/json", json.loads(reply.decode("utf-8"))["error"])

        status, _headers, reply = self.request(
            "POST",
            self.binding.endpoint,
            body=None,
            content_type="application/json",
            content_length=2 * 1024 * 1024 + 1,
        )
        self.assertEqual(status, 413)
        self.assertIn("exceeds byte limit", json.loads(reply.decode("utf-8"))["error"])

        status, _headers, reply = self.request(
            "POST",
            self.binding.endpoint,
            body=b"{}",
            content_type="application/json",
            extra_headers={"Transfer-Encoding": "chunked"},
        )
        self.assertEqual(status, 400)
        self.assertIn("transfer encoding", json.loads(reply.decode("utf-8"))["error"])


if __name__ == "__main__":
    unittest.main()
