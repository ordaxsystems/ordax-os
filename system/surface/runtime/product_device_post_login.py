"""Fail-soft Product-device enrollment orchestration after Native account login.

This module deliberately owns no HTTP route and no background scheduling. The Native
host may call it only after the account gateway has completed an authenticated login.
Enrollment failure never changes the account-login result, boot state or Surface health.
"""

from __future__ import annotations

from dataclasses import dataclass

from native_account_gateway import NativeAccountGatewayError
from product_device_enrollment import ProductDeviceEnrollmentError


@dataclass(frozen=True)
class PostLoginDeviceResult:
    status: str
    device_id: str | None = None
    error: str | None = None


def enroll_product_device_after_login(
    enrollment_client,
    device_profile: dict,
    *,
    distribution_profile: str,
    product_mode: str,
    stable_enrollment_authorized: bool = False,
) -> PostLoginDeviceResult:
    """Best-effort enrollment for an already-authenticated Native session.

    Owner/Development USB retains automatic post-login enrollment. Stable/MVP
    enrollment is available only from an explicitly authorized, signed-component
    opt-in path, never from passive session refresh or account login.
    """

    if product_mode != "usb":
        return PostLoginDeviceResult(status="inactive")
    if distribution_profile == "owner-development":
        channel = "development"
    elif distribution_profile == "stable-mvp" and stable_enrollment_authorized is True:
        channel = "stable"
    else:
        return PostLoginDeviceResult(status="inactive")

    if not isinstance(device_profile, dict):
        return PostLoginDeviceResult(status="invalid-device-profile", error="invalid-device-profile")
    name = device_profile.get("displayName")
    if not isinstance(name, str) or not name.strip():
        return PostLoginDeviceResult(status="invalid-device-profile", error="invalid-device-profile")

    try:
        receipt = enrollment_client.enroll(
            device_name=name,
            device_kind="laptop",
            channel=channel,
        )
    except (NativeAccountGatewayError, ProductDeviceEnrollmentError) as exc:
        code = getattr(exc, "code", "device-enrollment-failed")
        return PostLoginDeviceResult(status="unavailable", error=str(code))
    except (OSError, ValueError, TypeError):
        return PostLoginDeviceResult(status="unavailable", error="device-enrollment-failed")

    return PostLoginDeviceResult(status="enrolled", device_id=receipt.device_id)
