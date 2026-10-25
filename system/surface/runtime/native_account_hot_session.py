"""Kernel-memory only account continuity across Linux Native Host restarts.

This is not a disk credential vault. The kernel user keyring lives only during
the current boot. A full reboot always requires a new account sign-in.
"""
from __future__ import annotations

try:
    import ctypes
except ImportError:  # Python installations without libffi remain memory-only.
    ctypes = None
import hashlib
import json
import platform
import re
import sys
from collections.abc import Mapping

# Linux x86_64 syscall ABI; the Owner/Development USB currently targets amd64.
_SYS_ADD_KEY = 248
_SYS_KEYCTL = 250
_KEY_SPEC_USER_KEYRING = -4
_KEYCTL_UPDATE = 2
_KEYCTL_REVOKE = 3
_KEYCTL_UNLINK = 9
_KEYCTL_SEARCH = 10
_KEYCTL_READ = 11
_KEYCTL_SET_TIMEOUT = 15
_MAX_SECRET_BYTES = 40_000
_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
_COOKIE_RE = re.compile(r"^[^;\r\n]{1,16384}$")
_ALLOWED = frozenset(("ordax_access", "ordax_refresh"))


class KernelSessionUnavailable(RuntimeError):
    pass


class NativeKernelAccountSession:
    """A single-owner, current-boot cache. Never writes a credential to disk."""

    def __init__(self, origin: str) -> None:
        if ctypes is None or sys.platform != "linux" or platform.machine().lower() not in ("x86_64", "amd64"):
            raise KernelSessionUnavailable("linux-amd64-kernel-keyring-required")
        self._libc = ctypes.CDLL(None, use_errno=True)
        self._libc.syscall.restype = ctypes.c_long
        # Separate gateway authorities cannot read one another's account cache.
        self._description = b"ordax.native.account." + hashlib.sha256(
            origin.encode("utf-8")
        ).hexdigest().encode("ascii")

    def _syscall(self, operation: int, *args) -> int:
        result = self._libc.syscall(ctypes.c_long(operation), *args)
        if result < 0:
            code = ctypes.get_errno()
            raise OSError(code, "kernel account keyring unavailable")
        return int(result)

    def _key(self) -> int | None:
        try:
            return self._syscall(
                _SYS_KEYCTL,
                ctypes.c_long(_KEYCTL_SEARCH),
                ctypes.c_long(_KEY_SPEC_USER_KEYRING),
                ctypes.c_char_p(b"user"),
                ctypes.c_char_p(self._description),
                ctypes.c_long(0),
            )
        except OSError as exc:
            if exc.errno in (126, 127, 128):  # ENOKEY, EKEYEXPIRED, EKEYREVOKED
                return None
            raise KernelSessionUnavailable("kernel-keyring-search-failed") from exc

    def load(self) -> dict[str, str]:
        key = self._key()
        if key is None:
            return {}
        try:
            size = self._syscall(
                _SYS_KEYCTL, ctypes.c_long(_KEYCTL_READ),
                ctypes.c_long(key), ctypes.c_void_p(), ctypes.c_long(0),
            )
            if size < 1 or size > _MAX_SECRET_BYTES:
                self.clear()
                return {}
            buffer = ctypes.create_string_buffer(size)
            read = self._syscall(
                _SYS_KEYCTL, ctypes.c_long(_KEYCTL_READ),
                ctypes.c_long(key), ctypes.cast(buffer, ctypes.c_void_p),
                ctypes.c_long(size),
            )
            if read != size:
                return {}
            value = json.loads(buffer.raw.decode("utf-8"))
            if not isinstance(value, dict) or set(value) != _ALLOWED:
                self.clear()
                return {}
            if not all(isinstance(v, str) and _COOKIE_RE.fullmatch(v) for v in value.values()):
                self.clear()
                return {}
            return dict(value)
        except (OSError, UnicodeError, ValueError, TypeError):
            return {}

    def clear(self) -> None:
        key = self._key()
        if key is None:
            return
        try:
            self._syscall(_SYS_KEYCTL, ctypes.c_long(_KEYCTL_REVOKE), ctypes.c_long(key))
            self._syscall(
                _SYS_KEYCTL, ctypes.c_long(_KEYCTL_UNLINK),
                ctypes.c_long(key), ctypes.c_long(_KEY_SPEC_USER_KEYRING),
            )
        except OSError as exc:
            raise KernelSessionUnavailable("kernel-keyring-revoke-failed") from exc

    def save(self, cookies: Mapping[str, str]) -> None:
        if not cookies:
            self.clear()
            return
        if set(cookies) != _ALLOWED or not all(
            isinstance(v, str) and _COOKIE_RE.fullmatch(v) for v in cookies.values()
        ):
            self.clear()
            return
        payload = json.dumps(dict(cookies), separators=(",", ":")).encode("utf-8")
        if len(payload) > _MAX_SECRET_BYTES:
            raise KernelSessionUnavailable("account-session-too-large")
        existing = self._key()
        buffer = ctypes.create_string_buffer(payload)
        try:
            if existing is not None:
                key = self._syscall(
                    _SYS_KEYCTL, ctypes.c_long(_KEYCTL_UPDATE),
                    ctypes.c_long(existing), ctypes.cast(buffer, ctypes.c_void_p),
                    ctypes.c_long(len(payload)),
                )
                key = existing
            else:
                key = self._syscall(
                    _SYS_ADD_KEY, ctypes.c_char_p(b"user"),
                    ctypes.c_char_p(self._description),
                    ctypes.cast(buffer, ctypes.c_void_p),
                    ctypes.c_long(len(payload)),
                    ctypes.c_long(_KEY_SPEC_USER_KEYRING),
                )
            self._syscall(
                _SYS_KEYCTL, ctypes.c_long(_KEYCTL_SET_TIMEOUT),
                ctypes.c_long(key), ctypes.c_long(_SESSION_TTL_SECONDS),
            )
        except OSError as exc:
            try:
                self.clear()
            except KernelSessionUnavailable:
                pass
            raise KernelSessionUnavailable("kernel-keyring-update-failed") from exc
