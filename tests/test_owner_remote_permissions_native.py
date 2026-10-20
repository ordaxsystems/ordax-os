"""Live Native Host route contract (Platform remains mocked, no real grants)."""
from __future__ import annotations
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "system/surface/runtime/native_host_server.py"
spec = importlib.util.spec_from_file_location("native_host_remote_permissions_test", PATH)
host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(host)
CLIENT = "37d8b52b-cf98-4dc4-867c-726cb340b610"
DEVICE = "24630b00-e9c0-4d93-b38a-2367048cd9d1"


class FakeGateway:
    def __init__(self):
        self.enabled = False
        self.calls = []
    def remote_permissions(self):
        return {"schema": "ordax.owner-remote-permissions/1", "device_id": DEVICE,
                "clients": [{"client_id": CLIENT, "client_name": "ChatGPT"}],
                "grant_groups": []}
    def configure_remote_permission(self, client_id, enabled):
        self.calls.append((client_id, enabled))
        return self.remote_permissions()


class NativeRemotePermissionRoutes(unittest.TestCase):
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
        self.server.local_session_locked = False
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)
    def _stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
    def request(self, method, body=None, *, origin=True):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        data = None if body is None else json.dumps(body)
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = "http://127.0.0.1:" + str(self.server.server_address[1])
        try:
            connection.request(method, host.OWNER_REMOTE_PERMISSIONS_PATH, body=data, headers=headers)
            reply = connection.getresponse()
            raw = reply.read()
            return reply.status, json.loads(raw) if raw else None
        finally:
            connection.close()
    def test_status_and_explicit_client_mutation(self):
        status, snapshot = self.request("GET")
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["clients"][0]["client_id"], CLIENT)
        status, _ = self.request("POST", {"client_id": CLIENT, "enabled": True})
        self.assertEqual(status, 200)
        self.assertEqual(self.gateway.calls, [(CLIENT, True)])
    def test_no_implicit_full_access_from_login(self):
        self.request("GET")
        self.assertEqual(self.gateway.calls, [])
    def test_invalid_or_cross_origin_mutation_never_reaches_authority(self):
        for body in ({}, {"client_id": CLIENT, "enabled": "true"},
                     {"client_id": CLIENT, "enabled": True, "full_access": True}):
            self.assertEqual(self.request("POST", body)[0], 400)
        self.assertEqual(self.request("POST", {"client_id": CLIENT, "enabled": True},
                                      origin=False)[0], 403)
        self.server.local_session_locked = True
        self.assertEqual(self.request("POST", {"client_id": CLIENT, "enabled": True})[0], 423)
        self.assertEqual(self.gateway.calls, [])


if __name__ == "__main__":
    unittest.main()
