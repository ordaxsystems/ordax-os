"""Persistent Product device enrollment identity for OrdaX Native.

This module owns only device-local enrollment material. It does not authenticate
an account, call the Control Plane, start a heartbeat, or grant remote actions.
The account gateway remains the authenticated boundary and the existing Runtime
remains the only owner of scheduling/presence.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path

HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
DEVICE_KINDS = frozenset(("desktop", "laptop", "mobile", "server", "other"))
CHANNELS = frozenset(("stable", "development"))
MAX_STATE_BYTES = 4096


class ProductDeviceIdentityError(RuntimeError):
    pass


@dataclass(frozen=True)
class EnrollmentMaterial:
    device_token: str
    token_sha256: str
    machine_binding_sha256: str


class ProductDeviceIdentityStore:
    def __init__(self, state_dir: str) -> None:
        root = Path(state_dir)
        if not root.is_absolute():
            raise ValueError("state_dir must be absolute")
        self.root = root / "device-agent"
        self.local_path = self.root / "product-device-local.json"
        self.credential_path = self.root / "product-device.json"
        self.connector_visibility_path = self.root / "product-connector-visibility.json"

    @staticmethod
    def _sha256(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _private_regular_file(path: Path) -> bool:
        try:
            current = path.lstat()
        except FileNotFoundError:
            return False
        return (
            stat.S_ISREG(current.st_mode)
            and not path.is_symlink()
            and stat.S_IMODE(current.st_mode) == 0o600
            and 0 < current.st_size <= MAX_STATE_BYTES
        )

    def _ensure_root(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)

    def _atomic_write(self, path: Path, payload: dict[str, object]) -> None:
        self._ensure_root()
        temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}.{secrets.token_hex(4)}")
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            os.chmod(path, 0o600)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _load_local(self) -> dict[str, str] | None:
        if not self._private_regular_file(self.local_path):
            return None
        try:
            payload = json.loads(self.local_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict) or set(payload) != {"device_token", "machine_binding_secret"}:
            return None
        token = payload.get("device_token")
        binding = payload.get("machine_binding_secret")
        if not isinstance(token, str) or not HEX64_RE.fullmatch(token):
            return None
        if not isinstance(binding, str) or not HEX64_RE.fullmatch(binding):
            return None
        return {"device_token": token, "machine_binding_secret": binding}

    def prepare_enrollment(self) -> EnrollmentMaterial:
        payload = self._load_local()
        if payload is None:
            payload = {
                "device_token": secrets.token_hex(32),
                "machine_binding_secret": secrets.token_hex(32),
            }
            self._atomic_write(self.local_path, payload)
        token = payload["device_token"]
        binding = payload["machine_binding_secret"]
        return EnrollmentMaterial(
            device_token=token,
            token_sha256=self._sha256(token),
            machine_binding_sha256=self._sha256(binding),
        )

    def enrollment_payload(self, *, device_name: str, device_kind: str, channel: str) -> dict[str, str]:
        if not isinstance(device_name, str):
            raise TypeError("device_name must be a string")
        normalized_name = device_name.strip()
        if not 1 <= len(normalized_name) <= 120 or any(ord(ch) < 32 or ord(ch) == 127 for ch in normalized_name):
            raise ValueError("invalid device_name")
        if device_kind not in DEVICE_KINDS:
            raise ValueError("invalid device_kind")
        if channel not in CHANNELS:
            raise ValueError("invalid channel")
        material = self.prepare_enrollment()
        return {
            "operation": "enroll",
            "device_name": normalized_name,
            "device_kind": device_kind,
            "channel": channel,
            "token_sha256": material.token_sha256,
            "machine_binding_sha256": material.machine_binding_sha256,
        }

    def commit_enrollment(self, device_id: str) -> Path:
        if not isinstance(device_id, str) or not UUID_RE.fullmatch(device_id):
            raise ProductDeviceIdentityError("invalid-device-id")
        material = self.prepare_enrollment()
        self._atomic_write(
            self.credential_path,
            {
                "device_id": str(uuid.UUID(device_id)),
                "device_token": material.device_token,
            },
        )
        return self.credential_path

    def read_enrolled_credential(self) -> dict[str, str] | None:
        """Read only the private committed device identity; never mint on read.

        Open + fstat on one descriptor avoids path-replacement races after
        lstat. This secret is for the trusted Native Host, never Surface JS.
        """
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            fd = os.open(self.credential_path, flags)
        except (FileNotFoundError, OSError):
            return None
        try:
            meta = os.fstat(fd)
            if (not stat.S_ISREG(meta.st_mode)
                    or stat.S_IMODE(meta.st_mode) != 0o600
                    or not 0 < meta.st_size <= MAX_STATE_BYTES):
                return None
            raw = os.read(fd, MAX_STATE_BYTES + 1)
            if len(raw) > MAX_STATE_BYTES:
                return None
            payload = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        finally:
            os.close(fd)
        if not isinstance(payload, dict) or set(payload) != {"device_id", "device_token"}:
            return None
        device_id, token = payload["device_id"], payload["device_token"]
        if (not isinstance(device_id, str) or not UUID_RE.fullmatch(device_id)
                or not isinstance(token, str) or not HEX64_RE.fullmatch(token)):
            return None
        return {"device_id": device_id, "device_token": token}

    def connector_visibility_enabled(self) -> bool:
        """Read private Owner opt-in; missing/malformed state fails closed."""
        path = self.connector_visibility_path
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError:
            return False
        try:
            meta = os.fstat(descriptor)
            if (not stat.S_ISREG(meta.st_mode)
                    or meta.st_uid != os.geteuid()
                    or meta.st_nlink != 1
                    or stat.S_IMODE(meta.st_mode) != 0o600
                    or not 0 < meta.st_size <= MAX_STATE_BYTES):
                return False
            raw = os.read(descriptor, MAX_STATE_BYTES + 1)
            payload = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return False
        finally:
            os.close(descriptor)
        return (
            isinstance(payload, dict)
            and set(payload) == {"schema", "enabled"}
            and payload["schema"] == "ordax.product-connector-visibility/1"
            and payload["enabled"] is True
        )

    def set_connector_visibility(self, enabled: bool) -> None:
        """Persist only device discoverability, never OAuth or action grants."""
        if type(enabled) is not bool:
            raise TypeError("connector visibility must be a boolean")
        self._atomic_write(self.connector_visibility_path, {
            "schema": "ordax.product-connector-visibility/1",
            "enabled": enabled,
        })
