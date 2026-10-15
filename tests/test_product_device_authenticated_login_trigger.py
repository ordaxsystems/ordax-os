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
APP_DATA_HOST = RUNTIME / "native_app_data_host.py"

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

    def after_authenticated_login(self, profile: dict):
        self.calls.append(profile)
        if self.raises is not None:
            raise self.raises
        return types.SimpleNamespace(status="enrolled")


def make_proxy(gateway, coordinator, profile):
    return module.ProductDeviceAccountGatewayProxy(
        gateway,
        coordinator,
        lambda: profile,
    )


class ProductDeviceAuthenticatedLoginTriggerTests(unittest.TestCase):
    def test_authenticated_login_triggers_once_and_preserves_reply(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator()
        profile = {"displayName": "Meu OrdaX"}
        proxy = make_proxy(gateway, coordinator, profile)

        reply = proxy.login("owner@example.test", "secret")

        self.assertEqual(reply.status, 200)
        self.assertEqual(gateway.login_calls, [("owner@example.test", "secret")])
        self.assertEqual(gateway.session_calls, 1)
        self.assertEqual(coordinator.calls, [profile])

    def test_authenticated_profile_rename_reconciles_same_device(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator()
        proxy = make_proxy(gateway, coordinator, {"displayName": "Meu OrdaX"})

        final_profile = {"displayName": "Notebook de Washington"}
        proxy.reconcile_device_profile(final_profile)

        self.assertEqual(gateway.session_calls, 1)
        self.assertEqual(coordinator.calls, [final_profile])

    def test_failed_or_anonymous_login_never_enrolls(self):
        for login_status, authenticated in ((401, True), (200, False)):
            with self.subTest(login_status=login_status, authenticated=authenticated):
                gateway = FakeGateway(login_status=login_status, authenticated=authenticated)
                coordinator = FakeCoordinator()
                proxy = make_proxy(gateway, coordinator, {"displayName": "N"})
                reply = proxy.login("x@example.test", "bad")
                self.assertEqual(reply.status, login_status)
                self.assertEqual(coordinator.calls, [])

    def test_anonymous_profile_rename_never_enrolls(self):
        gateway = FakeGateway(authenticated=False)
        coordinator = FakeCoordinator()
        proxy = make_proxy(gateway, coordinator, {"displayName": "N"})
        proxy.reconcile_device_profile({"displayName": "Nome Final"})
        self.assertEqual(coordinator.calls, [])

    def test_enrollment_side_effect_cannot_change_successful_login_or_rename(self):
        gateway = FakeGateway()
        coordinator = FakeCoordinator(raises=OSError("control plane unavailable"))
        proxy = make_proxy(gateway, coordinator, {"displayName": "N"})
        reply = proxy.login("owner@example.test", "secret")
        self.assertEqual(reply.status, 200)
        proxy.reconcile_device_profile({"displayName": "Nome Final"})
        self.assertEqual(len(coordinator.calls), 2)

    def test_other_gateway_methods_delegate_unchanged(self):
        gateway = FakeGateway()
        proxy = make_proxy(gateway, FakeCoordinator(), {})
        self.assertEqual(proxy.logout().status, 204)

    def test_native_runtime_and_host_keep_enrollment_out_of_surface_js(self):
        runtime_text = APP_DATA_RUNTIME.read_text(encoding="utf-8")
        host_text = APP_DATA_HOST.read_text(encoding="utf-8")
        module_text = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('os.environ.get("ORDAX_PRODUCT_CONTROL_PLANE_URL", "")', runtime_text)
        self.assertIn("device_profile_reader=read_device_profile", runtime_text)
        self.assertIn("compose_product_device_account_gateway", runtime_text)
        self.assertNotIn("first_run_state_reader", runtime_text + module_text)
        self.assertIn('getattr(self.server.account_gateway, "reconcile_device_profile", None)', host_text)
        self.assertIn("write_device_profile(updated)", host_text)
        self.assertNotIn("/__ordax/native/device-enroll", runtime_text + host_text)
        self.assertNotIn("import threading", module_text)
        self.assertNotIn("time.sleep", module_text)
        self.assertNotIn("while True", module_text)


if __name__ == "__main__":
    unittest.main()
