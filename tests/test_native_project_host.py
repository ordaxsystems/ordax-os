#!/usr/bin/env python3

from __future__ import annotations

import http.client
import json
import os
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

from native_project_endpoint import MAX_PROJECT_REQUEST_BODY_BYTES  # noqa: E402
from native_project_host import (  # noqa: E402
    PROJECT_STATE_ENDPOINT,
    NativeProjectHostHandler,
    NativeProjectHostServer,
)


def empty_state():
    return {"nextOrdinal": 1, "projects": []}


def state_with_project(name="Projeto A"):
    return {
        "nextOrdinal": 2,
        "projects": [
            {
                "id": "project-1",
                "name": name,
                "path": "/Documentos/Projeto-A",
                "createdAt": 100,
                "lastOpenedAt": 100,
                "lastFilePath": None,
            }
        ],
    }


class NativeProjectHostHttpTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.static = self.temp / "static"
        self.static.mkdir()
        self.receipts = self.temp / "receipts"
        self.receipts.mkdir(mode=0o700)
        os.chmod(self.receipts, 0o700)
        self.user_root = self.temp / "user"
        self.session = self.temp / "session"
        self.session.mkdir()
        self.project_root = self.temp / "projects"

        handler = partial(NativeProjectHostHandler, directory=str(self.static))
        self.server = NativeProjectHostServer(
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
            app_data_root=str(self.temp / "app-data"),
            project_state_root=str(self.project_root),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.temporary.cleanup()

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
        status = response.status
        connection.close()
        return status, payload

    def json_request(self, method: str, target: str, value: dict | None = None, **kwargs):
        body = None if value is None else json.dumps(value, separators=(",", ":")).encode("utf-8")
        status, payload = self.request(
            method,
            target,
            body=body,
            content_type="application/json" if body is not None else None,
            **kwargs,
        )
        decoded = json.loads(payload.decode("utf-8")) if payload else None
        return status, decoded

    def test_get_and_compare_and_swap_use_one_native_project_record(self):
        status, initial = self.json_request("GET", PROJECT_STATE_ENDPOINT)
        self.assertEqual(status, 200)
        self.assertEqual(initial, {"record": None})

        status, stored = self.json_request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            {
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": state_with_project(),
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(stored, {"ok": True, "revision": 1})

        status, loaded = self.json_request("GET", PROJECT_STATE_ENDPOINT)
        self.assertEqual(status, 200)
        self.assertEqual(loaded["record"]["revision"], 1)
        self.assertEqual(loaded["record"]["state"], state_with_project())
        self.assertEqual(loaded["record"]["$schema"], "ordax.native-project-store-record/1")

    def test_stale_compare_and_swap_fails_closed_with_409(self):
        status, _ = self.json_request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            {
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": empty_state(),
            },
        )
        self.assertEqual(status, 200)

        status, conflict = self.json_request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            {
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": state_with_project("Stale"),
            },
        )
        self.assertEqual(status, 409)
        self.assertIn("revision conflict", conflict["error"])

        status, loaded = self.json_request("GET", PROJECT_STATE_ENDPOINT)
        self.assertEqual(status, 200)
        self.assertEqual(loaded["record"]["state"], empty_state())

    def test_route_rejects_foreign_origin_query_head_and_wrong_media_type(self):
        status, _ = self.json_request(
            "GET",
            PROJECT_STATE_ENDPOINT,
            origin="https://evil.example",
        )
        self.assertEqual(status, 403)

        status, query = self.json_request("GET", PROJECT_STATE_ENDPOINT + "?project=1")
        self.assertEqual(status, 400)
        self.assertIn("does not accept", query["error"])

        status, payload = self.request("HEAD", PROJECT_STATE_ENDPOINT)
        self.assertEqual(status, 405)
        self.assertEqual(payload, b"")

        body = json.dumps(
            {
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": empty_state(),
            }
        ).encode("utf-8")
        status, payload = self.request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            body=body,
            content_type="text/plain",
        )
        self.assertEqual(status, 415)
        self.assertIn("application/json", json.loads(payload.decode("utf-8"))["error"])

    def test_body_shape_transfer_encoding_and_bounds_fail_closed(self):
        status, invalid = self.json_request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            {"action": "compare-and-swap", "expectedRevision": 0},
        )
        self.assertEqual(status, 400)
        self.assertIn("shape", invalid["error"])

        status, payload = self.request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            body=b"{}",
            content_type="application/json",
            extra_headers={"Transfer-Encoding": "chunked"},
        )
        self.assertEqual(status, 400)
        self.assertIn("transfer encoding", json.loads(payload.decode("utf-8"))["error"])

        status, payload = self.request(
            "POST",
            PROJECT_STATE_ENDPOINT,
            body=None,
            content_type="application/json",
            content_length=MAX_PROJECT_REQUEST_BODY_BYTES + 1,
        )
        self.assertEqual(status, 413)
        self.assertIn("exceeds byte limit", json.loads(payload.decode("utf-8"))["error"])


if __name__ == "__main__":
    unittest.main()
