from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))
from product_device_identity import ProductDeviceIdentityStore  # noqa: E402
from product_device_post_login import PostLoginDeviceResult  # noqa: E402
from product_device_runtime import ProductDeviceAccountGatewayProxy, ProductDevicePostLoginCoordinator  # noqa: E402

SUBJECT = "123e4567-e89b-42d3-a456-426614174000"
OTHER_SUBJECT = "123e4567-e89b-42d3-a456-426614174001"

class Reply:
    def __init__(self, authenticated):
        self.status = 200
        self.body = json.dumps({"$schema": "prototype-ordax.public-identity-session/1",
            "authenticated": authenticated, "subject": SUBJECT,
            "status": "authenticated" if authenticated else "anonymous",
            "provider": "supabase", "email": "owner@example.test"}).encode()

class Gateway:
    def __init__(self):
        self.authenticated = True
    def session(self):
        return Reply(self.authenticated)

class ProductConnectorActivationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = ProductDeviceIdentityStore(self.tmp.name)

    def test_private_opt_in_defaults_off_and_fails_closed(self):
        self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))
        self.store.set_connector_visibility(True, SUBJECT)
        self.assertTrue(self.store.connector_visibility_enabled(SUBJECT))
        self.assertEqual(self.store.connector_visibility_path.stat().st_mode & 0o777, 0o600)
        self.store.connector_visibility_path.chmod(0o644)
        self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))
        self.store.connector_visibility_path.chmod(0o600)
        self.store.set_connector_visibility(False)
        self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))
        with self.assertRaises(TypeError):
            self.store.set_connector_visibility("true", SUBJECT)

    def test_visibility_is_bound_to_authenticated_account_identity(self):
        self.store.set_connector_visibility(True, SUBJECT)
        self.assertTrue(self.store.connector_visibility_enabled(SUBJECT))
        self.assertFalse(self.store.connector_visibility_enabled(OTHER_SUBJECT))
        self.assertFalse(self.store.connector_visibility_enabled())
        self.assertFalse(self.store.connector_visibility_enabled("not-an-account"))
        # Legacy pre-subject policy must never be treated as global consent.
        self.store.connector_visibility_path.write_text(
            '{"schema":"ordax.product-connector-visibility/1","enabled":true}', encoding="utf-8",
        )
        self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))

    def test_symlink_policy_rejected_without_following(self):
        self.store.set_connector_visibility(True, SUBJECT)
        path = self.store.connector_visibility_path
        actual = path.with_name("policy-source")
        path.rename(actual)
        path.symlink_to(actual)
        self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))

    def test_login_without_owner_opt_in_does_not_start_presence(self):
        profile = {"displayName": "OrdaX USB"}
        with (
            patch("product_device_runtime.ProductDeviceIdentityStore", return_value=self.store),
            patch("product_device_runtime.ProductDeviceEnrollmentClient"),
            patch("product_device_runtime.ProductDevicePresenceWorker") as worker,
            patch("product_device_runtime.enroll_product_device_after_login",
                return_value=PostLoginDeviceResult(status="enrolled")),
        ):
            coordinator = ProductDevicePostLoginCoordinator(Gateway(),
                distribution_profile="owner-development", product_mode="usb",
                development_discovery=False, control_plane_origin="https://cp.example", state_dir=self.tmp.name)
            self.assertEqual(coordinator.after_authenticated_login(profile).status, "enrolled")
            worker.return_value.start.assert_not_called()
            self.assertFalse(coordinator.visibility_status(authenticated=True, subject=SUBJECT)["enabled"])
            coordinator.configure_visibility(True, profile, subject=SUBJECT)
            worker.return_value.start.assert_called_once()
            self.assertEqual(coordinator.visibility_status(authenticated=True, subject=SUBJECT)["presenceState"], "unavailable")
            self.assertTrue(self.store.connector_visibility_enabled(SUBJECT))
            coordinator.configure_visibility(False, profile)
            worker.return_value.stop.assert_called_once_with(wait=False)
            self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))

    def test_other_account_login_never_reuses_prior_discovery_consent(self):
        profile = {"displayName": "OrdaX USB"}
        self.store.set_connector_visibility(True, SUBJECT)
        with (
            patch("product_device_runtime.ProductDeviceIdentityStore", return_value=self.store),
            patch("product_device_runtime.ProductDeviceEnrollmentClient"),
            patch("product_device_runtime.ProductDevicePresenceWorker") as worker,
            patch("product_device_runtime.enroll_product_device_after_login",
                return_value=PostLoginDeviceResult(status="enrolled")),
        ):
            coordinator = ProductDevicePostLoginCoordinator(Gateway(),
                distribution_profile="owner-development", product_mode="usb",
                development_discovery=False, control_plane_origin="https://cp.example", state_dir=self.tmp.name)
            coordinator.after_authenticated_login(profile, subject=OTHER_SUBJECT)
            worker.return_value.start.assert_not_called()
            self.assertFalse(coordinator.visibility_status(
                authenticated=True, subject=OTHER_SUBJECT,
            )["enabled"])
            coordinator.after_authenticated_login(profile, subject=SUBJECT)
            worker.return_value.start.assert_called_once()

    def test_authenticated_session_resumes_only_the_same_accounts_opted_in_worker(self):
        self.store.set_connector_visibility(True, SUBJECT)
        gateway = Gateway()
        with (
            patch("product_device_runtime.ProductDeviceIdentityStore", return_value=self.store),
            patch("product_device_runtime.ProductDeviceEnrollmentClient"),
            patch("product_device_runtime.ProductDevicePresenceWorker") as worker,
            patch("product_device_runtime.enroll_product_device_after_login",
                return_value=PostLoginDeviceResult(status="enrolled")) as enroll,
        ):
            coordinator = ProductDevicePostLoginCoordinator(gateway,
                distribution_profile="owner-development", product_mode="usb",
                development_discovery=False, control_plane_origin="https://cp.example", state_dir=self.tmp.name)
            proxy = ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {"displayName": "USB"})
            proxy.session()
            proxy.session()
            worker.return_value.start.assert_called_once()
            enroll.assert_called_once()
            gateway.authenticated = False
            status = proxy.connector_status()
            worker.return_value.stop.assert_called_once_with(wait=False)
            self.assertFalse(status["accountAuthenticated"])
            self.assertFalse(status["enabled"])
            self.assertEqual(status["presenceState"], "disabled")

    def make_development_coordinator(self, gateway=None):
        coordinator = ProductDevicePostLoginCoordinator(gateway or Gateway(),
            distribution_profile="owner-development", product_mode="usb",
            control_plane_origin="https://cp.example", state_dir=self.tmp.name)
        return coordinator

    def test_dev_startup_reports_enrolled_device_without_login(self):
        self.store.commit_enrollment(SUBJECT)
        with patch("product_device_runtime.ProductDevicePresenceWorker") as worker:
            coordinator = self.make_development_coordinator()
            worker.return_value.start.assert_called_once()
            gateway = Mock()
            proxy = ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {})
            status = proxy.connector_status()
            gateway.session.assert_not_called()
            self.assertTrue(status["enabled"])
            self.assertTrue(status["canEnableWithoutLogin"])
            self.assertFalse(status["accountAuthenticated"])
            self.assertFalse(status["remoteActionsEnabled"])

    def test_dev_local_disable_persists_and_reenable_needs_no_login(self):
        self.store.commit_enrollment(SUBJECT)
        with patch("product_device_runtime.ProductDevicePresenceWorker") as worker:
            coordinator = self.make_development_coordinator()
            proxy = ProductDeviceAccountGatewayProxy(Mock(), coordinator, lambda: {})
            self.assertFalse(proxy.configure_connector_visibility(False)["enabled"])
            worker.return_value.reset_mock()
            restarted = self.make_development_coordinator()
            worker.return_value.start.assert_not_called()
            restarted_proxy = ProductDeviceAccountGatewayProxy(Mock(), restarted, lambda: {})
            self.assertTrue(restarted_proxy.configure_connector_visibility(True)["enabled"])
            worker.return_value.start.assert_called_once()
            self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))

    def test_dev_logout_keeps_presence_but_runtime_shutdown_stops_it(self):
        self.store.commit_enrollment(SUBJECT)
        with patch("product_device_runtime.ProductDevicePresenceWorker") as worker:
            coordinator = self.make_development_coordinator()
            gateway = Mock()
            gateway.logout.return_value.status = 204
            proxy = ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {})
            proxy._authenticated = True
            proxy.logout()
            worker.return_value.stop.assert_not_called()
            proxy.close_product_presence()
            worker.return_value.stop.assert_called_once_with(wait=True)

    def test_dev_missing_credential_does_not_mint_or_publish_identity(self):
        with patch("product_device_runtime.ProductDevicePresenceWorker") as worker:
            coordinator = self.make_development_coordinator()
            worker.return_value.start.assert_not_called()
            self.assertFalse(coordinator.visibility_status(authenticated=False)["enabled"])
            self.assertFalse(self.store.credential_path.exists())
            coordinator.configure_visibility(False, {}, authenticated=False)
            with self.assertRaises(RuntimeError):
                coordinator.configure_visibility(True, {}, authenticated=False)

    def test_dev_rejects_unsafe_credential_and_visibility_policy(self):
        self.store.commit_enrollment(SUBJECT)
        self.assertTrue(self.store.development_visibility_enabled())
        self.store.credential_path.chmod(0o644)
        self.assertFalse(self.store.development_visibility_enabled())
        self.store.credential_path.chmod(0o600)
        self.store.set_development_connector_visibility(True)
        self.store.connector_visibility_path.chmod(0o644)
        self.assertFalse(self.store.development_visibility_enabled())
        self.store.connector_visibility_path.chmod(0o600)
        self.store.connector_visibility_path.write_text("{}")
        self.assertFalse(self.store.development_visibility_enabled())

    def test_dev_policy_does_not_follow_another_device_identity(self):
        self.store.commit_enrollment(SUBJECT)
        self.store.set_development_connector_visibility(True)
        self.store.commit_enrollment(OTHER_SUBJECT)
        self.assertFalse(self.store.development_visibility_enabled())

    def test_enable_fails_closed_when_enrollment_is_unavailable(self):
        with (
            patch("product_device_runtime.ProductDeviceIdentityStore", return_value=self.store),
            patch("product_device_runtime.ProductDeviceEnrollmentClient"),
            patch("product_device_runtime.ProductDevicePresenceWorker") as worker,
            patch("product_device_runtime.enroll_product_device_after_login",
                return_value=PostLoginDeviceResult(status="unavailable")),
        ):
            coordinator = ProductDevicePostLoginCoordinator(Gateway(),
                distribution_profile="owner-development", product_mode="usb",
                development_discovery=False, control_plane_origin="https://cp.example", state_dir=self.tmp.name)
            with self.assertRaises(RuntimeError):
                coordinator.configure_visibility(True, {"displayName": "USB"}, subject=SUBJECT)
            self.assertFalse(self.store.connector_visibility_enabled(SUBJECT))
            worker.return_value.start.assert_not_called()

    def test_proxy_requires_canonical_authenticated_session_for_enable(self):
        gateway = Gateway()
        coordinator = Mock()
        coordinator.visibility_status.return_value = {"available": True}
        proxy = ProductDeviceAccountGatewayProxy(gateway, coordinator, lambda: {"displayName":"USB"})
        gateway.authenticated = False
        with self.assertRaises(PermissionError):
            proxy.configure_connector_visibility(True)
        coordinator.configure_visibility.assert_not_called()
        # Local revocation never requires a live network session.
        proxy.configure_connector_visibility(False)
        coordinator.configure_visibility.assert_called_with(False, {}, authenticated=False)
        coordinator.reset_mock()
        proxy._authenticated = True
        proxy._subject = SUBJECT
        gateway.authenticated = False
        with self.assertRaises(PermissionError):
            proxy.configure_connector_visibility(True)
        coordinator.stop_presence.assert_called_once()
        coordinator.configure_visibility.assert_not_called()
        proxy._authenticated = True
        proxy._subject = SUBJECT
        gateway.authenticated = True
        proxy.configure_connector_visibility(True)
        coordinator.configure_visibility.assert_called_once_with(True, {"displayName":"USB"}, subject=SUBJECT)


if __name__ == "__main__":
    unittest.main()
