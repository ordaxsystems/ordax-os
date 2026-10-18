from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE_PATH = RUNTIME / "product_device_runtime.py"
APP_DATA_RUNTIME = RUNTIME / "native_app_data_runtime.py"

if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

spec = importlib.util.spec_from_file_location("product_device_runtime_under_test", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class Reply:
    def __init__(self, status: int, payload: dict | None = None):
        self.status = status
        self.body = b"" if payload is None else json.dumps(payload).encode("utf-8")


class FakeGateway:
    def __init__(self, *, login_status: int = 200, authenticated: bool = True):
        self.login_status = login_status
        self.authenticated = authenticated
        self.login_calls = []
        self.session_calls = 0

    def login(self, email: str, password: str):
        self.login_calls.append((email, password))
        return Reply(self.login_status, {"login": "canonical"})

    def session(self):
        self.session_calls += 1
        return Reply(200, {"authenticated": self.authenticated})

    def logout(self):
        return Reply(204)


class FakeCoordinator:
    def __init__(self, *, raises: Exception | None = None):
        self.calls = []
        self.raises = raises
        self.stop_calls = 0
        self.wait_values = []

    def stop_presence(self, *, wait=False):
        self.stop_calls += 1
        self.wait_values.append(wait)

    def after_authenticated_login(self, profile: dict):
        self.calls.append(profile)
        if self.raises is not None:
            raise self.raises
        return types.SimpleNamespace(status="enrolled")


class ProductDeviceAuthenticatedLoginTriggerTests(unittest.TestCase):
    def test_authenticated_login_triggers_once_and_preserves_reply(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator()
        profile = {"displayName": "OrdaX Notebook"}
        proxy = module.ProductDeviceAccountGatewayProxy(
            gateway,
            coordinator,
            lambda: profile,
        )

        reply = proxy.login("owner@example.test", "secret")

        self.assertEqual(reply.status, 200)
        self.assertEqual(gateway.login_calls, [("owner@example.test", "secret")])
        self.assertEqual(gateway.session_calls, 1)
        self.assertEqual(coordinator.calls, [profile])

    def test_failed_or_anonymous_login_never_enrolls(self):
        for login_status, authenticated in ((401, True), (200, False)):
            with self.subTest(login_status=login_status, authenticated=authenticated):
                gateway = FakeGateway(login_status=login_status, authenticated=authenticated)
                coordinator = FakeCoordinator()
                proxy = module.ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {"displayName": "N"})
                reply = proxy.login("x@example.test", "bad")
                self.assertEqual(reply.status, login_status)
                self.assertEqual(coordinator.calls, [])

    def test_enrollment_side_effect_cannot_change_successful_login(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator(raises=OSError("control plane unavailable"))
        proxy = module.ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {"displayName": "N"})
        reply = proxy.login("owner@example.test", "secret")
        self.assertEqual(reply.status, 200)
        self.assertEqual(gateway.session_calls, 1)

    def test_logout_stops_native_presence_only_after_success(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator()
        proxy = module.ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {})
        self.assertEqual(proxy.logout().status, 204)
        self.assertEqual(coordinator.stop_calls, 1)
        proxy.close_product_presence()
        self.assertEqual(coordinator.stop_calls, 2)
        self.assertEqual(coordinator.wait_values, [False, True]

    def test_other_gateway_methods_delegate_unchanged(self):
        gateway = FakeGateway()
        proxy = module.ProductDeviceAccountGatewayProxy(gateway, FakeCoordinator(), lambda: {})
        self.assertEqual(proxy.logout().status, 204)

    def test_native_runtime_consumes_inherited_owner_control_plane_without_ui_route(self):
        text = APP_DATA_RUNTIME.read_text(encoding="utf-8")
        module_text = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('os.environ.get("ORDAX_PRODUCT_CONTROL_PLANE_URL", "")', text)
        self.assertIn("device_profile_reader=read_device_profile", text)
        self.assertIn("compose_product_device_account_gateway", text)
        self.assertNotIn("/__ordax/native/device-enroll", text)
        self.assertNotIn("import threading", module_text)
        self.assertNotIn("time.sleep", module_text)
        self.assertNotIn("while True", module_text)


if __name__ == "__main__":
    unittest.main()
