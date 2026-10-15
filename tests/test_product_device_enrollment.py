import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENROLLMENT = ROOT / "system" / "surface" / "runtime" / "product_device_enrollment.py"
IDENTITY = ROOT / "system" / "surface" / "runtime" / "product_device_identity.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


enrollment = load_module("ordax_product_device_enrollment_test", ENROLLMENT)
identity = load_module("ordax_product_device_identity_for_enrollment_test", IDENTITY)


class FakeAccountGateway:
    def __init__(self, token="account-access-token"):
        self.token = token
        self.calls = 0

    def _product_access_token(self):
        self.calls += 1
        if isinstance(self.token, Exception):
            raise self.token
        return self.token


class FakeResponse:
    def __init__(self, body, status=200):
        self._body = body
        self.status = status
        self.closed = False

    def read(self, limit):
        return self._body[:limit]

    def close(self):
        self.closed = True


class FakeOpener:
    def __init__(self, response):
        self.response = response
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return self.response


class ProductDeviceEnrollmentTests(unittest.TestCase):
    def test_control_plane_must_be_bare_https_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            gateway = FakeAccountGateway()
            for invalid in (
                "http://cp.example",
                "https://user@cp.example",
                "https://cp.example/path",
                "https://cp.example/?x=1",
                "https://cp.example/#fragment",
            ):
                with self.assertRaises(ValueError):
                    enrollment.ProductDeviceEnrollmentClient(invalid, gateway, store)
            client = enrollment.ProductDeviceEnrollmentClient("https://cp.example/", gateway, store)
            self.assertEqual(client.origin, "https://cp.example")

    def test_missing_account_session_fails_before_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            gateway = FakeAccountGateway(RuntimeError("authentication-required"))
            client = enrollment.ProductDeviceEnrollmentClient("https://cp.example", gateway, store)
            opener = FakeOpener(FakeResponse(b"{}"))
            client._opener = opener
            with self.assertRaises(RuntimeError):
                client.enroll(device_name="Notebook", device_kind="laptop", channel="development")
            self.assertEqual(opener.requests, [])

    def test_request_uses_canonical_setup_and_hashes_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            material = store.prepare_enrollment()
            gateway = FakeAccountGateway("account-access-token")
            receipt_body = json.dumps({
                "ok": True,
                "protocol": "cloudflare-v3",
                "device_id": "123e4567-e89b-42d3-a456-426614174000",
            }).encode("utf-8")
            client = enrollment.ProductDeviceEnrollmentClient("https://cp.example", gateway, store)
            opener = FakeOpener(FakeResponse(receipt_body))
            client._opener = opener

            receipt = client.enroll(
                device_name="Notebook OrdaX",
                device_kind="laptop",
                channel="development",
            )

            self.assertEqual(receipt.device_id, "123e4567-e89b-42d3-a456-426614174000")
            self.assertEqual(len(opener.requests), 1)
            request, timeout = opener.requests[0]
            self.assertEqual(request.full_url, "https://cp.example/v3/device/setup")
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(timeout, 10.0)
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual(headers["authorization"], "Bearer account-access-token")
            payload = json.loads(request.data.decode("utf-8"))
            self.assertEqual(payload["operation"], "enroll")
            self.assertEqual(payload["token_sha256"], material.token_sha256)
            self.assertEqual(payload["machine_binding_sha256"], material.machine_binding_sha256)
            encoded = request.data.decode("utf-8")
            self.assertNotIn(material.device_token, encoded)
            local = json.loads(store.local_path.read_text(encoding="utf-8"))
            self.assertNotIn(local["machine_binding_secret"], encoded)
            credential = json.loads(store.credential_path.read_text(encoding="utf-8"))
            self.assertEqual(credential["device_token"], material.device_token)

    def test_invalid_or_error_response_does_not_commit_credential(self):
        cases = [
            (b"not-json", 200, "device-enrollment-response-invalid"),
            (b'{"ok":false,"error":"device_owner_mismatch"}', 403, "device_owner_mismatch"),
            (b'{"ok":true,"protocol":"wrong","device_id":"x"}', 200, "device-enrollment-response-invalid"),
        ]
        for body, status, code in cases:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temporary:
                store = identity.ProductDeviceIdentityStore(temporary)
                client = enrollment.ProductDeviceEnrollmentClient(
                    "https://cp.example", FakeAccountGateway(), store,
                )
                client._opener = FakeOpener(FakeResponse(body, status=status))
                with self.assertRaises(enrollment.ProductDeviceEnrollmentError) as raised:
                    client.enroll(device_name="Notebook", device_kind="laptop", channel="development")
                self.assertEqual(raised.exception.code, code)
                self.assertFalse(store.credential_path.exists())

    def test_source_does_not_log_or_persist_account_bearer(self):
        source = ENROLLMENT.read_text(encoding="utf-8").lower()
        self.assertNotIn("print(", source)
        self.assertNotIn("logging", source)
        self.assertNotIn("ordax_refresh", source)
        self.assertNotIn("write_text(token", source)
        self.assertIn("/v3/device/setup", source)
        self.assertIn("authorization", source)


if __name__ == "__main__":
    unittest.main()
