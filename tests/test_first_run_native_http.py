"""Disposable, real Native HTTP first-run route proof; no physical storage is touched."""

from functools import partial
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
spec = importlib.util.spec_from_file_location("ordax_native_first_run_http_proof", HOST)
native = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native)


class NativeFirstRunHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ordax-oobe-http-")
        self.root = Path(self.temporary.name)
        (self.root / "index.html").write_text("<!doctype html><title>OrdaX</title>", encoding="utf-8")
        self.receipt = self.root / "first-run.json"
        self.original_receipt = native.FIRST_RUN_FILE
        native.FIRST_RUN_FILE = str(self.receipt)
        handler = partial(native.NativeHostHandler, directory=str(self.root))
        try:
            self.server = native.NativeHostServer(
                ("127.0.0.1", 0),
                handler,
                user_root=str(self.root),
                power_request_path=str(self.root / "power-request"),
                network_session_dir=str(self.root),
            )
        except BaseException:
            native.FIRST_RUN_FILE = self.original_receipt
            self.temporary.cleanup()
            raise
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        native.FIRST_RUN_FILE = self.original_receipt
        self.temporary.cleanup()

    def request(self, method="GET", *, value=None, headers=None, path=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        outgoing = dict(headers or {})
        body = None
        if value is not None:
            body = json.dumps(value, separators=(",", ":")).encode("utf-8")
            outgoing["Content-Type"] = "application/json"
        try:
            connection.request(method, native.FIRST_RUN_PATH if path is None else path, body=body, headers=outgoing)
            response = connection.getresponse()
            status = response.status
            response_body = response.read()
            return status, response_body
        finally:
            connection.close()

    def complete(self, account_mode="local-only"):
        return {
            **native.initial_first_run_state(),
            "completed": True,
            "accountMode": account_mode,
        }

    def test_real_http_completion_is_durable_and_replay_is_idempotent(self):
        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), native.initial_first_run_state())
        self.assertFalse(self.receipt.exists())

        completed = self.complete()
        status, body = self.request(
            "POST",
            value=completed,
            headers={
                "Origin": f"http://127.0.0.1:{self.port}",
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self.assertEqual((status, body), (204, b""))
        self.assertTrue(self.receipt.exists())
        self.assertEqual(json.loads(self.receipt.read_text(encoding="utf-8")), completed)
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(json.loads(self.request()[1]), completed)
        self.assertEqual(self.request("POST", value=completed)[0], 204)
        self.assertEqual(json.loads(self.receipt.read_text(encoding="utf-8")), completed)

    def test_real_http_rejects_conflicting_identity_and_malformed_state(self):
        self.assertEqual(self.request("POST", value=self.complete())[0], 204)
        self.assertEqual(self.request("POST", value=self.complete("identity"))[0], 500)
        self.assertEqual(self.request("POST", value=native.initial_first_run_state())[0], 500)
        self.assertEqual(self.request("POST", value={"completed": True})[0], 400)
        self.assertEqual(json.loads(self.request()[1]), self.complete())

    def test_real_http_boundary_rejects_foreign_origin_and_host(self):
        completed = self.complete()
        foreign = {
            "Origin": "https://foreign.example",
            "Sec-Fetch-Site": "cross-site",
        }
        self.assertEqual(self.request("POST", value=completed, headers=foreign)[0], 403)
        self.assertEqual(self.request("GET", headers=foreign)[0], 403)
        self.assertEqual(self.request("POST", value=completed, headers={
            "Host": f"foreign.example:{self.port}",
        })[0], 403)
        self.assertFalse(self.receipt.exists())

    def test_real_http_guest_detach_is_available_without_a_configured_gateway(self):
        status, body = self.request("POST", path=native.ACCOUNT_LOGOUT_PATH)
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body), {
            "$schema": "ordax.native-account-detach/1",
            "localSessionDetached": True,
            "remoteRevocation": "not-applicable",
        })
        status, body = self.request(path=native.ACCOUNT_SESSION_PATH)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["provider"], "unconfigured")
        # Guest completion is still handled by the same durable Native receipt.
        self.assertEqual(self.request("POST", value=self.complete())[0], 204)

    def test_real_http_offline_logout_detaches_existing_account_before_guest_receipt(self):
        gateway = native.NativeAccountGateway(
            "https://accounts.example", str(self.root / "legacy-session.json")
        )
        gateway._cookies = {"ordax_access": "old-access", "ordax_refresh": "old-refresh"}
        def unreachable(*args, **kwargs):
            raise native.NativeAccountGatewayError("gateway-unreachable")
        gateway._request = unreachable
        self.server.account_gateway = gateway

        status, body = self.request("POST", path=native.ACCOUNT_LOGOUT_PATH)
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body), {
            "$schema": "ordax.native-account-detach/1",
            "localSessionDetached": True,
            "remoteRevocation": "unconfirmed",
        })
        self.assertEqual(gateway._cookies, {})
        self.assertFalse((self.root / "legacy-session.json").exists())
        status, body = self.request(path=native.ACCOUNT_SESSION_PATH)
        self.assertEqual(status, 200)
        guest = json.loads(body)
        self.assertFalse(guest["authenticated"])
        self.assertEqual(guest["status"], "anonymous")
        self.assertEqual(self.request("POST", value=self.complete())[0], 204)
        self.assertEqual(json.loads(self.receipt.read_text(encoding="utf-8"))["accountMode"], "local-only")

    def test_foreign_origin_cannot_detach_existing_authenticated_session(self):
        gateway = native.NativeAccountGateway(
            "https://accounts.example", str(self.root / "legacy-session.json")
        )
        gateway._cookies = {"ordax_access": "still-authorized"}
        self.server.account_gateway = gateway
        status, body = self.request("POST", path=native.ACCOUNT_LOGOUT_PATH, headers={
            "Origin": "https://foreign.example",
            "Sec-Fetch-Site": "cross-site",
        })
        self.assertEqual(status, 403)
        self.assertEqual(gateway._cookies, {"ordax_access": "still-authorized"})

    def test_existing_corrupt_receipt_is_never_overwritten(self):
        self.receipt.write_text("{corrupt", encoding="utf-8")
        self.assertEqual(json.loads(self.request()[1]), native.initial_first_run_state())
        self.assertEqual(self.request("POST", value=self.complete())[0], 500)
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "{corrupt")


if __name__ == "__main__":
    unittest.main()
