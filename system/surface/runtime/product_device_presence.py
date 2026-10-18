"""Native OrdaX Product device presence on the canonical PostgreSQL authority.

This is a client of the existing Product identity and presence contracts,
not a model provider, inference router, MCP server or remote command executor.
Only the Native Host holds the credential. No Surface route or second account.
"""
from __future__ import annotations

import json
import threading
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
    """One lifecycle-owned sender, started only after verified Native login.

    All retries and offline delivery use the same one worker. Its network
    failures never block Surface, boot, account login or local Intelligence.
    """

    def __init__(self, client: ProductDevicePresenceClient, *, interval_seconds: float = 120.0):
        if not 60 <= interval_seconds <= 3600:
            raise ValueError("invalid presence interval")
        self.client = client
        self.interval_seconds = float(interval_seconds)
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                if not self._stop.is_set():
                    return
                # A previous logout is finishing its offline report. Do not
                # reuse a stopped worker or overlap two device writers.
                self._thread.join(timeout=11.0)
                if self._thread.is_alive():
                    raise ProductDevicePresenceError("device-presence-worker-stopping")
            self._stop.clear()
            worker = threading.Thread(target=self._run, name="ordax-product-presence", daemon=True)
            self._thread = worker
            worker.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.client.report(True)
            except (OSError, ValueError, ProductDevicePresenceError):
                pass
            if self._stop.wait(self.interval_seconds):
                break
        try:
            self.client.report(False)
        except (OSError, ValueError, ProductDevicePresenceError):
            pass

    def stop(self, *, wait: bool = False) -> None:
        with self._lock:
            self._stop.set()
            thread = self._thread
        if wait and thread is not None and thread is not threading.current_thread():
            thread.join(timeout=11.0)
