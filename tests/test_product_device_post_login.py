import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

MODULE = RUNTIME / "product_device_post_login.py"
spec = importlib.util.spec_from_file_location("ordax_product_device_post_login_test", MODULE)
post_login = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = post_login
spec.loader.exec_module(post_login)

from product_device_enrollment import EnrollmentReceipt, ProductDeviceEnrollmentError


class FakeEnrollmentClient:
    def __init__(self, *, error=None):
        self.error = error
        self.calls = []

    def enroll(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return EnrollmentReceipt(
            device_id="123e4567-e89b-42d3-a456-426614174000",
            protocol="cloudflare-v3",
        )


class ProductDevicePostLoginTests(unittest.TestCase):
    def test_owner_development_usb_enrolls_with_persisted_display_name(self):
        client = FakeEnrollmentClient()
        result = post_login.enroll_product_device_after_login(
            client,
            {"schema": "ordax.device-profile/1", "displayName": "Meu Notebook", "devicePublicId": "ordax-12345678"},
            distribution_profile="owner-development",
            product_mode="usb",
        )
        self.assertEqual(result.status, "enrolled")
        self.assertEqual(result.device_id, "123e4567-e89b-42d3-a456-426614174000")
        self.assertEqual(
            client.calls,
            [{"device_name": "Meu Notebook", "device_kind": "laptop", "channel": "development"}],
        )

    def test_stable_and_native_disk_remain_inactive(self):
        for distribution_profile, product_mode in (
            ("stable-mvp", "usb"),
            ("owner-development", "native-disk"),
        ):
            client = FakeEnrollmentClient()
            result = post_login.enroll_product_device_after_login(
                client,
                {"displayName": "Meu OrdaX"},
                distribution_profile=distribution_profile,
                product_mode=product_mode,
            )
            self.assertEqual(result.status, "inactive")
            self.assertEqual(client.calls, [])

    def test_enrollment_failure_never_escapes_to_login_flow(self):
        client = FakeEnrollmentClient(
            error=ProductDeviceEnrollmentError("control-plane-unreachable")
        )
        result = post_login.enroll_product_device_after_login(
            client,
            {"displayName": "Meu OrdaX"},
            distribution_profile="owner-development",
            product_mode="usb",
        )
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(result.error, "control-plane-unreachable")

    def test_invalid_device_profile_does_not_attempt_network(self):
        for profile in (None, {}, {"displayName": "   "}):
            client = FakeEnrollmentClient()
            result = post_login.enroll_product_device_after_login(
                client,
                profile,
                distribution_profile="owner-development",
                product_mode="usb",
            )
            self.assertEqual(result.status, "invalid-device-profile")
            self.assertEqual(client.calls, [])

    def test_orchestrator_has_no_background_or_remote_action_behavior(self):
        source = MODULE.read_text(encoding="utf-8").lower()
        for forbidden in (
            "threading",
            "while true",
            "while :",
            "subprocess",
            "remote action",
            "x-ordax-device-token",
            "/v3/product/device/presence",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
