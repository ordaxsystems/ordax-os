"""Native OrdaX Product device presence on the canonical PostgreSQL authority.

This is a client of the existing Product identity and presence contracts,
not a model provider, inference router, MCP server or remote command executor.
Only the Native Host holds the credential. No Surface route or second account.
"""
from __future__ import annotations

import json
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from product_device_enrollment import (
    _NoRedirect,
    _validated_control_plane_origin,
    MAX_RESPONSE_BYTES,
)


class ProductDevicePresenceError(RuntimeError):
    """Bounded failure with no response body or credential in the message."""


class ProductDevicePresenceClient:
    def __init__(self, origin: str, identity_store, *, timeout_seconds: float = 5.0):
        self.origin = _validated_control_plane_origin(origin)
        if not 1 <= timeout_seconds <= 15:
            raise ValueError("invalid presence timeout")
        self._store = identity_store
        self._timeout = float(timeout_seconds)
        self._opener = build_opener(_NoRedirect())

    def report(self, online: bool) -> bool:
        """A presence signal has no grant, project, Space or action authority."""
        credential = self._store.read_enrolled_credential()
        if credential is None:
            return False
        device_id = credential["device_id"]
        body = json.dumps({
            "online": bool(online),
            "runtime_kind": "ordax-os",
            "agent_version": "ordax-os",
            "capability_digest": None,
        }, separators=(",", ":"), sort_keys=True).encode("utf-8")
        request = Request(
            self.origin + "/v3/product/device/presence",
            data=body, method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Ordax-Device-Id": device_id,
                "X-Ordax-Device-Token": credential["device_token"],
                "User-Agent": "OrdaX-Native-Product-Presence/1",
            },
        )
        try:
            response = self._opener.open(request, timeout=self._timeout)
            try:
                status = int(response.status)
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            finally:
                response.close()
        except HTTPError as exc:
            # Do not expose the HTTP body; it may be untrusted.
            exc.close()
            raise ProductDevicePresenceError("device-presence-rejected") from None
        except (URLError, OSError, TimeoutError):
            raise ProductDevicePresenceError("device-presence-unreachable") from None
        if status != 200 or len(raw) > MAX_RESPONSE_BYTES:
            raise ProductDevicePresenceError("device-presence-invalid-receipt")
        try:
            receipt = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            raise ProductDevicePresenceError("device-presence-invalid-receipt") from None
        if not isinstance(receipt, dict) or receipt.get("ok") is not True or receipt.get("device_id") != device_id:
            raise ProductDevicePresenceError("device-presence-invalid-receipt")
        return True


class ProductDevicePresenceWorker:
    """One Native Host-owned presence loop; no per-login worker duplication.

    Logout disables discovery without blocking the account reply. Rapid
    login/logout transitions reuse the same worker, so an old offline sender
    cannot race a newly spawned online worker. Shutdown joins it briefly.
    """

    def __init__(self, client: ProductDevicePresenceClient, *, interval_seconds: float = 120.0):
        if not 60 <= interval_seconds <= 3600:
            raise ValueError("invalid presence interval")
        self.client = client
        self.interval_seconds = float(interval_seconds)
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._enabled = False
        self._closed = False
        self._last_online_attempt: float | None = None
        self._last_online_receipt: float | None = None

    def start(self) -> None:
        with self._lock:
            if self._closed:
                raise ProductDevicePresenceError("device-presence-worker-closed")
            was_enabled = self._enabled
            if not was_enabled:
                self._last_online_attempt = None
                self._last_online_receipt = None
            self._enabled = True
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._run, name="ordax-product-presence", daemon=True,
                )
                self._thread.start()
            elif not was_enabled:
                self._wake.set()

    def _report(self, online: bool) -> None:
        accepted = False
        try:
            accepted = self.client.report(online) is True
        except (OSError, ValueError, ProductDevicePresenceError):
            pass
        # Only the existing presence worker observes server acknowledgement.
        # Never infer connectivity from an owner preference or unverified reply.
        with self._lock:
            if online and self._enabled and not self._closed:
                self._last_online_attempt = time.monotonic()
                if accepted:
                    self._last_online_receipt = self._last_online_attempt

    def connection_state(self) -> str:
        """Bounded projection; no extra heartbeat, credentials or probe."""
        with self._lock:
            if not self._enabled or self._closed:
                return "disabled"
            if self._last_online_attempt is None:
                return "connecting"
            if (
                self._last_online_receipt is not None
                and self._last_online_receipt >= self._last_online_attempt
                and time.monotonic() - self._last_online_receipt <= 3 * self.interval_seconds
            ):
                return "confirmed"
            return "unavailable"

    def _run(self) -> None:
        last_reported_state: bool | None = None
        while True:
            with self._lock:
                enabled = self._enabled and not self._closed
                closing = self._closed

            if enabled:
                self._report(True)
                last_reported_state = True
            elif last_reported_state is not False:
                # Also send offline at shutdown, even if the first online
                # heartbeat was interrupted by a crash or network failure.
                self._report(False)
                last_reported_state = False

            if closing:
                return

            self._wake.wait(self.interval_seconds if enabled else None)
            self._wake.clear()

    def stop(self, *, wait: bool = False) -> None:
        with self._lock:
            self._enabled = False
            self._last_online_attempt = None
            self._last_online_receipt = None
            if wait:
                self._closed = True
            thread = self._thread
        self._wake.set()
        if wait and thread is not None and thread is not threading.current_thread():
            thread.join(timeout=11.0)
