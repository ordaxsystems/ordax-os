"""No persisted credentials, no invented grants; authority is Platform-only."""
from __future__ import annotations
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1] / "system/surface/runtime"
sys.path.insert(0, str(ROOT))
from product_device_owner_grants import ProductOwnerRemotePermissions, OwnerRemotePermissionError
DEVICE = "24630b00-e9c0-4d93-b38a-2367048cd9d1"
CLIENT = "37d8b52b-cf98-4dc4-867c-726cb340b610"
GROUP = "4f9bf794-a8f3-4a3d-9a0f-37bc0151b03a"
class Gateway:
    def session(self):
        class Reply:
            status = 200
            body = json.dumps({"authenticated": True, "subject": CLIENT}).encode()
        return Reply()
    def _product_access_token(self):
        return "test-only-private-bearer"
class Identity:
    def read_enrolled_credential(self):
        return {"device_id": DEVICE, "device_token": "private-not-disclosed"}
class Opener:
    def __init__(self):
        self.calls = []
        self.group = False
    def open(self, request, timeout):
        self.calls.append((request.get_method(), request.full_url,
                           request.data.decode() if request.data else None))
        if request.get_method() == "POST":
            self.group = True
            result = {"ok": True}
        elif request.get_method() == "DELETE":
            self.group = False
            result = {"ok": True}
        else:
            result = {"ok": True, "device_id": DEVICE,
                      "clients": [{"client_id": CLIENT, "client_name": "ChatGPT"}],
                      "grant_groups": [{
                          "grant_group_id": GROUP, "client_id": CLIENT,
                          "profile_key": "full-computer-control", "scope_kind": "device",
                          "client_consent_active": True, "device_id": DEVICE,
                      }] if self.group else []}
        class Reply:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return json.dumps(result).encode()
        return Reply()
class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.open = Opener()
        self.authority = ProductOwnerRemotePermissions(
            "https://mcp.ordax.com.br", Gateway(), Identity(), opener=self.open)
    def test_read_does_not_create_grants(self):
        result = self.authority.read()
        self.assertEqual(result["device_id"], DEVICE)
        self.assertEqual(len(result["grant_groups"]), 0)
        self.assertNotIn("device_token", json.dumps(result))
        self.assertEqual([call[0] for call in self.open.calls], ["GET"])
    def test_enable_and_revoke_use_canonical_platform_only(self):
        self.assertEqual(len(self.authority.configure(CLIENT, True)["grant_groups"]), 1)
        self.assertFalse(self.authority.configure(CLIENT, False)["grant_groups"])
        mutations = [(method, url) for method, url, body in self.open.calls
                     if method != "GET"]
        self.assertEqual([m[0] for m in mutations], ["POST", "DELETE"])
        self.assertTrue(all("/v3/owner/remote-grant-groups" in m[1] for m in mutations))
    def test_no_success_on_stale_authority_postcondition(self):
        class NoopOpener(Opener):
            def open(self, request, timeout):
                method = request.get_method()
                if method == "POST":
                    self.calls.append((method, request.full_url, None))
                    class Reply:
                        status = 200
                        def __enter__(self): return self
                        def __exit__(self, *args): pass
                        def read(self, n): return b'{"ok":true}'
                    return Reply()
                return super().open(request, timeout)
        opener = NoopOpener()
        authority = ProductOwnerRemotePermissions(
            "https://mcp.ordax.com.br", Gateway(), Identity(), opener=opener)
        with self.assertRaisesRegex(OwnerRemotePermissionError, "remote-permission-not-confirmed"):
            authority.configure(CLIENT, True)
        self.assertEqual([call[0] for call in opener.calls], ["GET", "POST", "GET"])

    def test_oversized_grant_list_fails_closed_before_any_mutation(self):
        class OversizedOpener(Opener):
            def open(self, request, timeout):
                result = {"ok": True, "device_id": DEVICE,
                          "clients": [{"client_id": CLIENT, "client_name": "ChatGPT"}],
                          "grant_groups": [{}] * 301}
                self.calls.append((request.get_method(), request.full_url, None))
                class Reply:
                    status = 200
                    def __enter__(self): return self
                    def __exit__(self, *args): pass
                    def read(self, n): return json.dumps(result).encode()
                return Reply()
        opener = OversizedOpener()
        authority = ProductOwnerRemotePermissions(
            "https://mcp.ordax.com.br", Gateway(), Identity(), opener=opener)
        with self.assertRaisesRegex(OwnerRemotePermissionError, "remote-authority-invalid-response"):
            authority.configure(CLIENT, False)
        self.assertEqual([call[0] for call in opener.calls], ["GET"])

    def test_invalid_client_cannot_mutate(self):
        with self.assertRaises(OwnerRemotePermissionError):
            self.authority.configure("chatgpt", True)
        self.assertEqual(self.open.calls, [])

if __name__ == "__main__":
    unittest.main()
