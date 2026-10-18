"""Integration proof for the existing loopback-only Native Host Connector route."""
from __future__ import annotations

import http.client
import importlib.util
import json
from pathlib import Path
import threading
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system/surface/runtime/native_host_server.py"
spec = importlib.util.spec_from_file_location("native_host_product_connector_test", HOST)
host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(host)


class FakeGateway:
    def __init__(self):
        self.enabled = False
        self.authenticated = True
        self.calls = []

    def connector_status(self):
        return {
            "available": True,
            "enabled": self.enabled,
            "accountAuthenticated": self.authenticated,
            "requiresClientOAuthAndGrants": True,
            "remoteActionsEnabled": False,
            "mode": "discovery-only",
        }

    def configure_connector_visibility(self, enabled):
        if not self.authenticated and enabled:
            raise PermissionError("not-authenticated")
        self.calls.append(enabled)
        self.enabled = enabled
        return self.connector_status()


class NativeProductConnectorEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = host.NativeHostServer(
            ("127.0.0.1", 0), host.NativeHostHandler,
            user_root=self.tmp.name,
            power_request_path=str(Path(self.tmp.name) / "power-request"),
            network_session_dir=self.tmp.name,
        )
        self.gateway = FakeGateway()
        self.server.account_gateway = self.gateway
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, body=None, *, path=None, content_type="application/json"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        payload = None if body is None else json.dumps(body)
        headers = {"Content-Type": content_type} if payload is not None else {}
        try:
            connection.request(method, path or host.PRODUCT_CONNECTOR_SETTINGS_PATH,
                body=payload, headers=headers)
            reply = connection.getresponse()
            raw = reply.read()
            return reply.status, json.loads(raw) if raw else None
        finally:
            connection.close()

    def test_current_policy_is_read_only_and_does_not_grant_actions(self):
        status, payload = self.request("GET")
        self.assertEqual(status, 200)
        self.assertFalse(payload["enabled"])
        self.assertFalse(payload["remoteActionsEnabled"])
        self.assertTrue(payload["requiresClientOAuthAndGrants"])

    def test_explicit_toggle_controls_existing_native_owner_only(self):
        status, payload = self.request("POST", {"enabled": True})
        self.assertEqual(status, 200)
        self.assertTrue(payload["enabled"])
        self.assertEqual(self.gateway.calls, [True])
        self.gateway.authenticated = False
        self.assertEqual(self.request("POST", {"enabled": True})[0], 401)
        status, payload = self.request("POST", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertFalse(payload["enabled"])
        self.assertEqual(self.gateway.calls, [True, False])

    def test_invalid_payloads_cannot_be_coerced_to_permissions(self):
        for body in ({}, {"enabled": "true"}, {"enabled": 1},
                     {"enabled": True, "fullAccess": True}):
            with self.subTest(body=body):
                self.assertEqual(self.request("POST", body)[0], 400)
        self.assertEqual(self.gateway.calls, [])

    def test_route_is_not_available_without_native_product_gateway(self):
        self.server.account_gateway = None
        self.assertEqual(self.request("GET")[0], 503)
        self.assertEqual(self.request("POST", {"enabled": True})[0], 503)


if __name__ == "__main__":
    unittest.main()
