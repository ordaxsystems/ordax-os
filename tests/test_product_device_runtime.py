from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import product_device_runtime as runtime  # noqa: E402


class ProductDeviceRuntimeTests(unittest.TestCase):
    def test_stable_and_native_disk_remain_inactive(self):
        gateway = object()
        with patch.object(runtime, "ProductDeviceIdentityStore") as identity_store:
            stable = runtime.ProductDevicePostLoginCoordinator(
                gateway,
                distribution_profile="stable-mvp",
                product_mode="usb",
                control_plane_origin="https://cp.example",
            )
            native_disk = runtime.ProductDevicePostLoginCoordinator(
                gateway,
                distribution_profile="owner-development",
                product_mode="native-disk",
                control_plane_origin="https://cp.example",
            )
        identity_store.assert_not_called()
        self.assertEqual(stable.after_authenticated_login({}).status, "inactive")
        self.assertEqual(native_disk.after_authenticated_login({}).status, "inactive")

    def test_missing_gateway_or_origin_remains_inactive(self):
        with patch.object(runtime, "ProductDeviceIdentityStore") as identity_store:
            no_gateway = runtime.ProductDevicePostLoginCoordinator(
                None,
                distribution_profile="owner-development",
                product_mode="usb",
                control_plane_origin="https://cp.example",
            )
            no_origin = runtime.ProductDevicePostLoginCoordinator(
                object(),
                distribution_profile="owner-development",
                product_mode="usb",
                control_plane_origin="",
            )
        identity_store.assert_not_called()
        self.assertEqual(no_gateway.after_authenticated_login({}).status, "inactive")
        self.assertEqual(no_origin.after_authenticated_login({}).status, "inactive")

    def test_owner_usb_uses_canonical_state_and_existing_account_gateway(self):
        gateway = object()
        fake_store = object()
        fake_client = object()
        with (
            patch.object(runtime, "ProductDeviceIdentityStore", return_value=fake_store) as identity_store,
            patch.object(runtime, "ProductDeviceEnrollmentClient", return_value=fake_client) as client,
            patch.object(runtime, "ProductDevicePresenceWorker") as presence_worker,
        ):
            coordinator = runtime.ProductDevicePostLoginCoordinator(
                gateway,
                distribution_profile="owner-development",
                product_mode="usb",
                control_plane_origin="https://cp.example",
            )
        identity_store.assert_called_once_with("/var/lib/ordax")
        client.assert_called_once_with("https://cp.example", gateway, fake_store)
        self.assertIs(coordinator.client, fake_client)
        presence_worker.assert_called_once()

    def test_invalid_control_plane_configuration_fails_soft(self):
        gateway = object()
        with patch.object(runtime, "ProductDeviceEnrollmentClient", side_effect=ValueError("invalid origin")):
            coordinator = runtime.ProductDevicePostLoginCoordinator(
                gateway,
                distribution_profile="owner-development",
                product_mode="usb",
                control_plane_origin="http://unsafe.example",
                state_dir="/tmp/ordax-test-state",
            )
        self.assertEqual(coordinator.after_authenticated_login({}).status, "inactive")

    def test_authenticated_login_delegates_to_existing_fail_soft_orchestrator(self):
        gateway = object()
        fake_client = object()
        expected = runtime.PostLoginDeviceResult(status="enrolled", device_id="00000000-0000-4000-8000-000000000001")
        profile = {"displayName": "Surface Dev"}
        with (
            patch.object(runtime, "ProductDeviceIdentityStore", return_value=object()),
            patch.object(runtime, "ProductDeviceEnrollmentClient", return_value=fake_client),
            patch.object(runtime, "enroll_product_device_after_login", return_value=expected) as enroll,
            patch.object(runtime, "ProductDevicePresenceWorker") as worker,
        ):
            coordinator = runtime.ProductDevicePostLoginCoordinator(
                gateway,
                distribution_profile="owner-development",
                product_mode="usb",
                control_plane_origin="https://cp.example",
            )
            result = coordinator.after_authenticated_login(profile)
        self.assertEqual(result, expected)
        worker.return_value.start.assert_called_once()
        enroll.assert_called_once_with(
            fake_client,
            profile,
            distribution_profile="owner-development",
            product_mode="usb",
        )


if __name__ == "__main__":
    unittest.main()
