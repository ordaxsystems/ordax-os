"""Runtime composition for fail-soft Product-device enrollment.

This module keeps Product-device setup out of Surface JavaScript and owns no HTTP
route, heartbeat, background thread or remote-action capability. It only composes
existing enrollment primitives for the Native host after an authenticated login.
"""

from __future__ import annotations

import json

from product_device_enrollment import ProductDeviceEnrollmentClient
from product_device_identity import ProductDeviceIdentityStore
from product_device_post_login import PostLoginDeviceResult, enroll_product_device_after_login

# Inside the graphical chroot, /var/lib/ordax is the existing private persistent
# bind of the host's /state/ordax/native-state. Keep Product-device material on
# that proven persistence boundary rather than creating or exposing a new mount.
DEFAULT_PRODUCT_DEVICE_STATE_DIR = "/var/lib/ordax"


class ProductDevicePostLoginCoordinator:
    def __init__(
        self,
        account_gateway,
        *,
        distribution_profile: str,
        product_mode: str,
        control_plane_origin: str,
        state_dir: str = DEFAULT_PRODUCT_DEVICE_STATE_DIR,
    ) -> None:
        self.distribution_profile = distribution_profile
        self.product_mode = product_mode
        self.client = None

        if distribution_profile != "owner-development" or product_mode != "usb":
            return
        if account_gateway is None or not isinstance(control_plane_origin, str) or not control_plane_origin.strip():
            return

        try:
            identity_store = ProductDeviceIdentityStore(state_dir)
            self.client = ProductDeviceEnrollmentClient(
                control_plane_origin,
                account_gateway,
                identity_store,
            )
        except (TypeError, ValueError):
            # Configuration errors must never make account login, boot or Surface
            # health depend on the development Control Plane.
            self.client = None

    def after_authenticated_login(self, device_profile: dict) -> PostLoginDeviceResult:
        if self.client is None:
            return PostLoginDeviceResult(status="inactive")
        return enroll_product_device_after_login(
            self.client,
            device_profile,
            distribution_profile=self.distribution_profile,
            product_mode=self.product_mode,
        )


class ProductDeviceAccountGatewayProxy:
    """Delegate account traffic and add one fail-soft post-login side effect.

    The wrapped gateway remains the owner of credentials and session cookies. The
    proxy never changes a login reply and never exposes account/device secrets to
    the HTTP caller. Enrollment is attempted only after the canonical session
    endpoint confirms ``authenticated=true``.
    """

    def __init__(self, gateway, coordinator, device_profile_reader) -> None:
        self._gateway = gateway
        self._coordinator = coordinator
        self._device_profile_reader = device_profile_reader

    def __getattr__(self, name):
        return getattr(self._gateway, name)

    def login(self, email: str, password: str):
        reply = self._gateway.login(email, password)
        if getattr(reply, "status", None) not in {200, 202, 303}:
            return reply

        try:
            session_reply = self._gateway.session()
            session_payload = json.loads(session_reply.body.decode("utf-8"))
            if isinstance(session_payload, dict) and session_payload.get("authenticated") is True:
                profile = self._device_profile_reader()
                self._coordinator.after_authenticated_login(profile)
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, AttributeError):
            # Product-device discovery is optional in this increment. Account login
            # remains authoritative and must never fail because enrollment did.
            pass
        return reply


def compose_product_device_account_gateway(
    account_gateway,
    *,
    distribution_profile: str,
    product_mode: str,
    control_plane_origin: str,
    device_profile_reader,
    state_dir: str = DEFAULT_PRODUCT_DEVICE_STATE_DIR,
):
    """Return the original gateway unless Owner/Development USB can enroll safely."""
    coordinator = ProductDevicePostLoginCoordinator(
        account_gateway,
        distribution_profile=distribution_profile,
        product_mode=product_mode,
        control_plane_origin=control_plane_origin,
        state_dir=state_dir,
    )
    if coordinator.client is None:
        return account_gateway
    return ProductDeviceAccountGatewayProxy(
        account_gateway,
        coordinator,
        device_profile_reader,
    )
