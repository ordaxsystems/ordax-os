"""Runtime composition for fail-soft Product-device enrollment.

This module keeps Product-device setup out of Surface JavaScript and owns no HTTP
route, heartbeat, background thread or remote-action capability. It only composes
existing enrollment primitives for the Native host after an authenticated login.
"""

from __future__ import annotations

from product_device_enrollment import ProductDeviceEnrollmentClient
from product_device_identity import ProductDeviceIdentityStore
from product_device_post_login import PostLoginDeviceResult, enroll_product_device_after_login

DEFAULT_PRODUCT_DEVICE_STATE_DIR = "/state/ordax"


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

        identity_store = ProductDeviceIdentityStore(state_dir)
        self.client = ProductDeviceEnrollmentClient(
            control_plane_origin,
            account_gateway,
            identity_store,
        )

    def after_authenticated_login(self, device_profile: dict) -> PostLoginDeviceResult:
        if self.client is None:
            return PostLoginDeviceResult(status="inactive")
        return enroll_product_device_after_login(
            self.client,
            device_profile,
            distribution_profile=self.distribution_profile,
            product_mode=self.product_mode,
        )
