"""Authenticated Product-device enrollment transport for OrdaX Native.

The caller must provide the existing NativeAccountGateway and local
ProductDeviceIdentityStore. The account bearer is borrowed only inside this
native process to authenticate the canonical Control Plane `/v3/device/setup`
request. It is never returned, logged, persisted elsewhere or exposed to
Surface JavaScript.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 64 * 1024


class ProductDeviceEnrollmentError(RuntimeError):
    def __init__(self, code: str, *, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        return None


@dataclass(frozen=True)
class EnrollmentReceipt:
    device_id: str
    protocol: str


def _validated_control_plane_origin(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("control plane origin must be a string")
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("control plane origin must be a bare HTTPS origin")
    return f"https://{parsed.netloc}"


class ProductDeviceEnrollmentClient:
    def __init__(
        self,
        control_plane_origin: str,
        account_gateway,
        identity_store,
        *,
        timeout_seconds: float = 10.0,
    ) -> None:
        self.origin = _validated_control_plane_origin(control_plane_origin)
        self.account_gateway = account_gateway
        self.identity_store = identity_store
        self.timeout_seconds = timeout_seconds
        self._opener = build_opener(_NoRedirect())

    def enroll(self, *, device_name: str, device_kind: str, channel: str) -> EnrollmentReceipt:
        payload = self.identity_store.enrollment_payload(
            device_name=device_name,
            device_kind=device_kind,
            channel=channel,
        )
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        token = self.account_gateway._product_access_token()
        request = Request(
            self.origin + "/v3/device/setup",
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "User-Agent": "OrdaX-Product-Device-Enrollment/1",
            },
        )
        try:
            response = self._opener.open(request, timeout=self.timeout_seconds)
            try:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
            finally:
                response.close()
        except HTTPError as exc:
            raw = exc.read(MAX_RESPONSE_BYTES + 1)
            status = int(exc.code)
        except (URLError, OSError) as exc:
            raise ProductDeviceEnrollmentError("control-plane-unreachable") from exc

        if len(raw) > MAX_RESPONSE_BYTES:
            raise ProductDeviceEnrollmentError("control-plane-response-too-large", status=status)
        try:
            reply = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ProductDeviceEnrollmentError("device-enrollment-response-invalid", status=status) from exc
        if not isinstance(reply, dict):
            raise ProductDeviceEnrollmentError("device-enrollment-response-invalid", status=status)
        if status != 200 or reply.get("ok") is not True:
            code = reply.get("error") if isinstance(reply.get("error"), str) else "device-enrollment-failed"
            raise ProductDeviceEnrollmentError(code, status=status)
        if reply.get("protocol") != "cloudflare-v3" or not isinstance(reply.get("device_id"), str):
            raise ProductDeviceEnrollmentError("device-enrollment-response-invalid", status=status)

        try:
            credential_path = self.identity_store.commit_enrollment(reply["device_id"])
        except Exception as exc:
            raise ProductDeviceEnrollmentError("device-credential-persist-failed", status=status) from exc
        del credential_path
        return EnrollmentReceipt(device_id=reply["device_id"], protocol="cloudflare-v3")
