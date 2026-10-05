#!/usr/bin/env python3
"""Root-owned one-shot handoff for trusted Native App Data port composition.

The Native HTTP owner mints opaque App Data bindings from verified current-boot
receipts. This module moves only the already-validated binding descriptors to
the privileged WebKit host through a root-owned tmpfs file. The file is never an
app API, is consumed once, and never carries receipt digests.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
from dataclasses import dataclass
from pathlib import PurePosixPath

APP_DATA_PORT_BOOTSTRAP_SCHEMA = "ordax.native-app-data-port-bootstrap/1"
APP_DATA_PORT_BOOTSTRAP_STATUS = "verified-current-boot"
DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH = "/run/ordax-surface/app-data-port-bindings.json"
APP_DATA_PORT_BOOTSTRAP_MODE = 0o600
APP_DATA_PORT_BOOTSTRAP_DIR_MODE = 0o700
MAX_APP_DATA_PORT_BOOTSTRAP_BYTES = 128 * 1024
MAX_APP_DATA_PORT_BOOTSTRAP_BINDINGS = 256

_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_PUBLISHER_RE = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_ENDPOINT_RE = re.compile(r"^/__ordax/native/app-data/[A-Za-z0-9_-]{43}$")


class NativeAppDataPortBootstrapError(RuntimeError):
    pass


@dataclass(frozen=True)
class TrustedNativeAppDataPortBootstrapBinding:
    app_id: str
    endpoint: str
    publisher_id: str
    owner_scope: str = "device"

    def as_payload(self) -> dict:
        return {
            "appId": self.app_id,
            "endpoint": self.endpoint,
            "ownerScope": self.owner_scope,
            "publisherId": self.publisher_id,
        }


def _validate_uid(expected_uid: int) -> int:
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise TypeError("expected uid is invalid")
    return expected_uid


def _path_parts(path: str) -> tuple[str, str]:
    if not isinstance(path, str) or not path.startswith("/") or "\x00" in path:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap path is invalid")
    parsed = PurePosixPath(path)
    if parsed.name in {"", ".", ".."}:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap filename is invalid")
    return str(parsed.parent), parsed.name


def _open_owned_directory(path: str, *, expected_uid: int) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise NativeAppDataPortBootstrapError("App Data bootstrap directory is unavailable") from exc
    info = os.fstat(fd)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != APP_DATA_PORT_BOOTSTRAP_DIR_MODE
    ):
        os.close(fd)
        raise NativeAppDataPortBootstrapError(
            "App Data bootstrap directory ownership/mode is invalid"
        )
    return fd


def _normalize_binding(value: object) -> TrustedNativeAppDataPortBootstrapBinding:
    if isinstance(value, dict):
        if set(value) != {"appId", "endpoint", "ownerScope", "publisherId"}:
            raise NativeAppDataPortBootstrapError("App Data bootstrap binding fields are invalid")
        app_id = value["appId"]
        endpoint = value["endpoint"]
        owner_scope = value["ownerScope"]
        publisher_id = value["publisherId"]
    else:
        app_id = getattr(value, "app_id", None)
        endpoint = getattr(value, "endpoint", None)
        owner_scope = getattr(value, "owner_scope", None)
        publisher_id = getattr(value, "publisher_id", None)

    if not isinstance(app_id, str) or _APP_ID_RE.fullmatch(app_id) is None:
        raise NativeAppDataPortBootstrapError("App Data bootstrap app id is invalid")
    if not isinstance(publisher_id, str) or _PUBLISHER_RE.fullmatch(publisher_id) is None:
        raise NativeAppDataPortBootstrapError("App Data bootstrap publisher id is invalid")
    if owner_scope != "device":
        raise NativeAppDataPortBootstrapError("App Data bootstrap owner scope is invalid")
    if not isinstance(endpoint, str) or _ENDPOINT_RE.fullmatch(endpoint) is None:
        raise NativeAppDataPortBootstrapError("App Data bootstrap endpoint is invalid")

    return TrustedNativeAppDataPortBootstrapBinding(
        app_id=app_id,
        endpoint=endpoint,
        publisher_id=publisher_id,
        owner_scope="device",
    )


def validate_app_data_port_bootstrap(value: object) -> tuple[TrustedNativeAppDataPortBootstrapBinding, ...]:
    if not isinstance(value, dict) or set(value) != {"$schema", "status", "bindings"}:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap fields are not canonical")
    if (
        value["$schema"] != APP_DATA_PORT_BOOTSTRAP_SCHEMA
        or value["status"] != APP_DATA_PORT_BOOTSTRAP_STATUS
    ):
        raise NativeAppDataPortBootstrapError("App Data port bootstrap schema/status is invalid")
    raw_bindings = value["bindings"]
    if (
        not isinstance(raw_bindings, list)
        or len(raw_bindings) > MAX_APP_DATA_PORT_BOOTSTRAP_BINDINGS
    ):
        raise NativeAppDataPortBootstrapError("App Data port bootstrap binding list is invalid")

    normalized = tuple(_normalize_binding(entry) for entry in raw_bindings)
    identities = [(entry.publisher_id, entry.app_id) for entry in normalized]
    if len(set(identities)) != len(identities):
        raise NativeAppDataPortBootstrapError("App Data port bootstrap identity is duplicated")
    if identities != sorted(identities):
        raise NativeAppDataPortBootstrapError("App Data port bootstrap bindings must be sorted")
    return normalized


def _payload_bytes(bindings: object) -> bytes:
    if not isinstance(bindings, (tuple, list)):
        raise TypeError("App Data bootstrap bindings must be a tuple/list")
    normalized = tuple(_normalize_binding(entry) for entry in bindings)
    normalized = tuple(sorted(normalized, key=lambda entry: (entry.publisher_id, entry.app_id)))
    if len(normalized) > MAX_APP_DATA_PORT_BOOTSTRAP_BINDINGS:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap has too many bindings")
    identities = [(entry.publisher_id, entry.app_id) for entry in normalized]
    if len(set(identities)) != len(identities):
        raise NativeAppDataPortBootstrapError("App Data port bootstrap identity is duplicated")
    value = {
        "$schema": APP_DATA_PORT_BOOTSTRAP_SCHEMA,
        "status": APP_DATA_PORT_BOOTSTRAP_STATUS,
        "bindings": [entry.as_payload() for entry in normalized],
    }
    payload = (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")
    if not payload or len(payload) > MAX_APP_DATA_PORT_BOOTSTRAP_BYTES:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap exceeds byte limit")
    return payload


def clear_app_data_port_bootstrap(
    path: str = DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    *,
    expected_uid: int,
) -> None:
    uid = _validate_uid(expected_uid)
    directory, name = _path_parts(path)
    dir_fd = _open_owned_directory(directory, expected_uid=uid)
    try:
        try:
            os.unlink(name, dir_fd=dir_fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise NativeAppDataPortBootstrapError(
                "stale App Data port bootstrap could not be removed"
            ) from exc
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def publish_app_data_port_bootstrap(
    bindings: object,
    path: str = DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    *,
    expected_uid: int,
) -> int:
    uid = _validate_uid(expected_uid)
    payload = _payload_bytes(bindings)
    directory, name = _path_parts(path)
    dir_fd = _open_owned_directory(directory, expected_uid=uid)
    temporary = f".{name}-{secrets.token_hex(16)}.tmp"
    temp_fd = -1
    try:
        try:
            os.unlink(name, dir_fd=dir_fd)
        except FileNotFoundError:
            pass
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        temp_fd = os.open(temporary, flags, APP_DATA_PORT_BOOTSTRAP_MODE, dir_fd=dir_fd)
        os.fchmod(temp_fd, APP_DATA_PORT_BOOTSTRAP_MODE)
        offset = 0
        while offset < len(payload):
            written = os.write(temp_fd, payload[offset:])
            if written <= 0:
                raise OSError("short write while persisting App Data port bootstrap")
            offset += written
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = -1
        os.replace(temporary, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        os.fsync(dir_fd)

        verify_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        verify_fd = os.open(name, verify_flags, dir_fd=dir_fd)
        try:
            info = os.fstat(verify_fd)
            stored = bytearray()
            while len(stored) < info.st_size:
                chunk = os.read(verify_fd, min(4096, info.st_size - len(stored)))
                if not chunk:
                    break
                stored.extend(chunk)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != uid
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != APP_DATA_PORT_BOOTSTRAP_MODE
                or bytes(stored) != payload
                or os.read(verify_fd, 1)
            ):
                raise NativeAppDataPortBootstrapError(
                    "persisted App Data port bootstrap failed verification"
                )
        finally:
            os.close(verify_fd)
    except OSError as exc:
        raise NativeAppDataPortBootstrapError("App Data port bootstrap could not be published") from exc
    finally:
        if temp_fd >= 0:
            os.close(temp_fd)
        try:
            os.unlink(temporary, dir_fd=dir_fd)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        os.close(dir_fd)
    return len(validate_app_data_port_bootstrap(json.loads(payload.decode("utf-8"))))


def consume_app_data_port_bootstrap(
    path: str = DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    *,
    expected_uid: int,
) -> tuple[TrustedNativeAppDataPortBootstrapBinding, ...]:
    uid = _validate_uid(expected_uid)
    directory, name = _path_parts(path)
    dir_fd = _open_owned_directory(directory, expected_uid=uid)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        try:
            fd = os.open(name, flags, dir_fd=dir_fd)
        except OSError as exc:
            raise NativeAppDataPortBootstrapError("App Data port bootstrap is unavailable") from exc
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != uid
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != APP_DATA_PORT_BOOTSTRAP_MODE
                or info.st_size < 1
                or info.st_size > MAX_APP_DATA_PORT_BOOTSTRAP_BYTES
            ):
                raise NativeAppDataPortBootstrapError(
                    "App Data port bootstrap ownership/mode is invalid"
                )
            payload = bytearray()
            while len(payload) < info.st_size:
                chunk = os.read(fd, min(4096, info.st_size - len(payload)))
                if not chunk:
                    break
                payload.extend(chunk)
            if len(payload) != info.st_size or os.read(fd, 1):
                raise NativeAppDataPortBootstrapError(
                    "App Data port bootstrap changed while reading"
                )

            current = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            if current.st_dev != info.st_dev or current.st_ino != info.st_ino:
                raise NativeAppDataPortBootstrapError(
                    "App Data port bootstrap was replaced while reading"
                )
        finally:
            os.close(fd)

        try:
            decoded = json.loads(bytes(payload).decode("utf-8", errors="strict"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise NativeAppDataPortBootstrapError("App Data port bootstrap is invalid JSON") from exc
        bindings = validate_app_data_port_bootstrap(decoded)
        try:
            os.unlink(name, dir_fd=dir_fd)
        except OSError as exc:
            raise NativeAppDataPortBootstrapError(
                "App Data port bootstrap could not be consumed one-shot"
            ) from exc
        os.fsync(dir_fd)
        return bindings
    finally:
        os.close(dir_fd)
