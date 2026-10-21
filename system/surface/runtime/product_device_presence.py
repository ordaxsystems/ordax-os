"""Native OrdaX Product device presence on the canonical PostgreSQL authority.

This is a client of the existing Product identity and presence contracts,
not a model provider, inference router, MCP server or remote command executor.
Only the Native Host holds the credential. No Surface route or second account.
"""
from __future__ import annotations

import fcntl
import json
import os
import stat
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

    def _acquire_runtime_instance_lock(self) -> int | None:
        """Use the *existing* canonical native agent singleton lock.

        Native Runtime owns product-runtime/instance.lock while its process
        handles attested sessions and heartbeats. Discovery takes the same
        advisory lock only while an HTTPS report is in flight. A busy lock
        means Runtime is responsible for presence; never send a conflicting
        offline/online report or create a separate leader-election authority.
        """
        runtime_dir = self._store.root.parent / "product-runtime"
        directory_fd = None
        lock_fd = None
        try:
            runtime_dir.mkdir(mode=0o700, exist_ok=True)
            directory_fd = os.open(
                runtime_dir,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
            )
            directory = os.fstat(directory_fd)
            if (not stat.S_ISDIR(directory.st_mode)
                    or directory.st_uid != os.geteuid()
                    or stat.S_IMODE(directory.st_mode) != 0o700):
                raise ProductDevicePresenceError("device-presence-runtime-state-unsafe")
            lock_fd = os.open(
                "instance.lock",
                os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                0o600, dir_fd=directory_fd,
            )
            locked = os.fstat(lock_fd)
            if (not stat.S_ISREG(locked.st_mode)
                    or locked.st_uid != os.geteuid()
                    or locked.st_nlink != 1
                    or stat.S_IMODE(locked.st_mode) != 0o600):
                raise ProductDevicePresenceError("device-presence-runtime-lock-unsafe")
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                # The one upstream Runtime has exclusive control of this
                # device identity; discovery simply skips this tick.
                return None
            owned = lock_fd
            lock_fd = None
            return owned
        except OSError as exc:
            raise ProductDevicePresenceError("device-presence-runtime-lock-unavailable") from exc
        finally:
            if lock_fd is not None:
                os.close(lock_fd)
            if directory_fd is not None:
                os.close(directory_fd)

    def report(self, online: bool) -> bool:
        """A presence signal has no grant, project, Space or action authority."""
        credential = self._store.read_enrolled_credential()
        if credential is None:
            return False
        lock_fd = self._acquire_runtime_instance_lock()
        if lock_fd is None:
            return False
        try:
            return self._report_with_owned_lock(online, credential)
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)

    def _report_with_owned_lock(self, online: bool, credential: dict[str, str]) -> bool:
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
        if wait and thread is not None:
            # Runtime may take over the Product heartbeat only after a
            # confirmed join. A timed-out join is NOT evidence of shutdown:
            # allowing the new Runtime to start would create two device
            # identity owners and competing online/offline writes.
            if thread is threading.current_thread():
                raise ProductDevicePresenceError("device-presence-stop-from-own-thread")
            thread.join(timeout=11.0)
            if thread.is_alive():
                raise ProductDevicePresenceError("device-presence-worker-still-running")
