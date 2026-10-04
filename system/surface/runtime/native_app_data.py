#!/usr/bin/env python3
"""Private atomic Native persistence for sandboxed App Data partitions."""

from __future__ import annotations

from contextlib import contextmanager
import base64
import binascii
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat

APP_DATA_PARTITION_SCHEMA = "ordax.native-app-data-partition/1"
APP_DATA_OWNER_SCOPE = "device"
DEFAULT_APP_DATA_ROOT = "/var/lib/ordax/app-data/v1"
DEFAULT_APP_DATA_QUOTA_BYTES = 8 * 1024 * 1024
DEFAULT_APP_DATA_MAX_KEYS = 1024
MAX_APP_DATA_VALUE_BYTES = 1024 * 1024
MAX_APP_DATA_PARTITION_BYTES = 64 * 1024 * 1024
MAX_APP_DATA_PARTITION_KEYS = 4096
MAX_APP_DATA_FILE_BYTES = 96 * 1024 * 1024
MAX_APP_DATA_KEY_CHARS = 128
MAX_SAFE_REVISION = 9007199254740991

_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_PUBLISHER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{0,119}$")
_KEY_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")


class AppDataConflictError(ValueError):
    def __init__(self, expected_revision: int, actual_revision: int) -> None:
        super().__init__(f"App Data revision conflict: expected {expected_revision}, actual {actual_revision}")
        self.expected_revision = expected_revision
        self.actual_revision = actual_revision


def _identity(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"publisherId", "appId", "ownerScope"}:
        raise ValueError("App Data identity shape is invalid")
    publisher_id = value.get("publisherId")
    app_id = value.get("appId")
    if not isinstance(publisher_id, str) or not _PUBLISHER_ID_RE.fullmatch(publisher_id):
        raise ValueError("App Data publisher id is invalid")
    if not isinstance(app_id, str) or not _APP_ID_RE.fullmatch(app_id):
        raise ValueError("App Data app id is invalid")
    if value.get("ownerScope") != APP_DATA_OWNER_SCOPE:
        raise ValueError("App Data v1 supports device-local ownership only")
    return {"publisherId": publisher_id, "appId": app_id, "ownerScope": APP_DATA_OWNER_SCOPE}


def _key(value: object) -> str:
    if not isinstance(value, str) or len(value) > MAX_APP_DATA_KEY_CHARS or not _KEY_RE.fullmatch(value):
        raise ValueError("App Data key is invalid")
    return value


def _revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_REVISION:
        raise ValueError("App Data revision is invalid")
    return value


def _quota(quota_bytes: int, max_keys: int) -> tuple[int, int]:
    if isinstance(quota_bytes, bool) or not isinstance(quota_bytes, int) or not 1 <= quota_bytes <= MAX_APP_DATA_PARTITION_BYTES:
        raise ValueError("App Data quota bytes are invalid")
    if isinstance(max_keys, bool) or not isinstance(max_keys, int) or not 1 <= max_keys <= MAX_APP_DATA_PARTITION_KEYS:
        raise ValueError("App Data max keys are invalid")
    return quota_bytes, max_keys


def _value(value: object) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise ValueError("App Data value must be bytes")
    payload = bytes(value)
    if len(payload) > MAX_APP_DATA_VALUE_BYTES:
        raise ValueError("App Data value exceeds per-value hard bound")
    return payload


def _partition_digest(identity: dict) -> str:
    canonical = f"{identity['publisherId']}\0{identity['appId']}\0{identity['ownerScope']}".encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _partition_paths(root: str, identity: dict) -> tuple[str, str]:
    digest = _partition_digest(identity)
    return os.path.join(root, f"{digest}.json"), os.path.join(root, f"{digest}.lock")


def _validate_root(root: str, *, create: bool) -> bool:
    if not isinstance(root, str) or not root or "\x00" in root or not os.path.isabs(root):
        raise ValueError("App Data root is invalid")
    try:
        metadata = os.lstat(root)
    except FileNotFoundError:
        if not create:
            return False
        parent = os.path.dirname(root)
        parent_metadata = os.lstat(parent)
        if not stat.S_ISDIR(parent_metadata.st_mode) or stat.S_ISLNK(parent_metadata.st_mode):
            raise ValueError("App Data root parent is unsafe")
        os.mkdir(root, 0o700)
        directory = os.open(parent, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        metadata = os.lstat(root)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("App Data root is not a real directory")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("App Data root permissions are not private")
    return True


def _validate_existing_file(path: str) -> bool:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("App Data partition target is unsafe")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("App Data partition permissions are not private")
    if metadata.st_size > MAX_APP_DATA_FILE_BYTES:
        raise ValueError("App Data partition file exceeds hard bound")
    return True


def _empty_partition(identity: dict) -> dict:
    return {
        "$schema": APP_DATA_PARTITION_SCHEMA,
        "identity": dict(identity),
        "revision": 0,
        "entries": {},
    }


def _decode_entry(value: object) -> bytes:
    if not isinstance(value, str):
        raise ValueError("App Data encoded value is invalid")
    try:
        decoded = base64.b64decode(value.encode("ascii"), validate=True)
    except (UnicodeError, binascii.Error) as exc:
        raise ValueError("App Data encoded value is invalid") from exc
    if len(decoded) > MAX_APP_DATA_VALUE_BYTES:
        raise ValueError("App Data stored value exceeds hard bound")
    if base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("App Data encoded value is not canonical")
    return decoded


def _validate_partition(value: object, expected_identity: dict) -> tuple[dict, int]:
    if not isinstance(value, dict) or set(value) != {"$schema", "identity", "revision", "entries"}:
        raise ValueError("App Data partition shape is invalid")
    if value.get("$schema") != APP_DATA_PARTITION_SCHEMA:
        raise ValueError("App Data partition schema is invalid")
    identity = _identity(value.get("identity"))
    if identity != expected_identity:
        raise ValueError("App Data partition identity binding mismatch")
    revision = _revision(value.get("revision"))
    entries = value.get("entries")
    if not isinstance(entries, dict) or len(entries) > MAX_APP_DATA_PARTITION_KEYS:
        raise ValueError("App Data partition entries are invalid or unbounded")
    decoded_entries: dict[str, bytes] = {}
    bytes_used = 0
    for raw_key, encoded in entries.items():
        key = _key(raw_key)
        decoded = _decode_entry(encoded)
        bytes_used += len(decoded)
        if bytes_used > MAX_APP_DATA_PARTITION_BYTES:
            raise ValueError("App Data partition bytes exceed hard bound")
        decoded_entries[key] = decoded
    return {
        "$schema": APP_DATA_PARTITION_SCHEMA,
        "identity": identity,
        "revision": revision,
        "entries": decoded_entries,
    }, bytes_used


def _read_partition(identity: dict, root: str) -> tuple[dict, int]:
    if not _validate_root(root, create=False):
        return _empty_partition(identity), 0
    target, _ = _partition_paths(root, identity)
    if not _validate_existing_file(target):
        return _empty_partition(identity), 0
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(target, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > MAX_APP_DATA_FILE_BYTES:
            raise ValueError("App Data partition changed to an unsafe file")
        remaining = MAX_APP_DATA_FILE_BYTES + 1
        chunks: list[bytes] = []
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > MAX_APP_DATA_FILE_BYTES:
            raise ValueError("App Data partition file exceeds hard bound")
    finally:
        os.close(descriptor)
    try:
        parsed = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("App Data partition is corrupt") from exc
    return _validate_partition(parsed, identity)


def _encoded_partition(partition: dict) -> bytes:
    encoded_entries = {
        key: base64.b64encode(value).decode("ascii")
        for key, value in sorted(partition["entries"].items())
    }
    payload = {
        "$schema": APP_DATA_PARTITION_SCHEMA,
        "identity": dict(partition["identity"]),
        "revision": partition["revision"],
        "entries": encoded_entries,
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_APP_DATA_FILE_BYTES:
        raise ValueError("App Data encoded partition exceeds file hard bound")
    return encoded


def _write_partition(partition: dict, root: str) -> None:
    _validate_root(root, create=True)
    target, _ = _partition_paths(root, partition["identity"])
    _validate_existing_file(target)
    encoded = _encoded_partition(partition)
    temp_path = os.path.join(root, f".tmp-{os.getpid()}-{secrets.token_hex(16)}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temp_path, flags, 0o600)
    try:
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written <= 0:
                raise OSError("short write while persisting App Data")
            offset += written
        os.fsync(descriptor)
        os.fchmod(descriptor, 0o600)
    except Exception:
        os.close(descriptor)
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise
    else:
        os.close(descriptor)
    try:
        os.replace(temp_path, target)
        directory = os.open(root, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


@contextmanager
def _exclusive_partition_lock(identity: dict, root: str):
    _validate_root(root, create=True)
    _, lock_path = _partition_paths(root, identity)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError("App Data partition lock is unsafe")
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def read_app_data(identity: object, key: object, root: str = DEFAULT_APP_DATA_ROOT) -> dict:
    bound = _identity(identity)
    validated_key = _key(key)
    partition, _ = _read_partition(bound, root)
    value = partition["entries"].get(validated_key)
    return {
        "revision": partition["revision"],
        "found": value is not None,
        "key": validated_key,
        "value": None if value is None else bytes(value),
    }


def list_app_data(
    identity: object,
    root: str = DEFAULT_APP_DATA_ROOT,
    *,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    quota_bytes, max_keys = _quota(quota_bytes, max_keys)
    bound = _identity(identity)
    partition, bytes_used = _read_partition(bound, root)
    return {
        "revision": partition["revision"],
        "keys": sorted(partition["entries"]),
        "bytesUsed": bytes_used,
        "quotaBytes": quota_bytes,
        "maxKeys": max_keys,
    }


def put_app_data(
    identity: object,
    key: object,
    value: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
    *,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    quota_bytes, max_keys = _quota(quota_bytes, max_keys)
    bound = _identity(identity)
    validated_key = _key(key)
    payload = _value(value)
    expected = _revision(expected_revision)
    with _exclusive_partition_lock(bound, root):
        partition, bytes_used = _read_partition(bound, root)
        actual = partition["revision"]
        if actual != expected:
            raise AppDataConflictError(expected, actual)
        previous = partition["entries"].get(validated_key)
        if previous is None and len(partition["entries"]) >= max_keys:
            raise ValueError("App Data partition key quota exceeded")
        next_bytes = bytes_used - (0 if previous is None else len(previous)) + len(payload)
        if next_bytes > quota_bytes:
            raise ValueError("App Data partition byte quota exceeded")
        if actual >= MAX_SAFE_REVISION:
            raise ValueError("App Data partition revision is exhausted")
        partition["entries"][validated_key] = payload
        partition["revision"] = actual + 1
        _write_partition(partition, root)
        return {"revision": partition["revision"], "stored": True}


def delete_app_data(
    identity: object,
    key: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
    *,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    _quota(quota_bytes, max_keys)
    bound = _identity(identity)
    validated_key = _key(key)
    expected = _revision(expected_revision)
    with _exclusive_partition_lock(bound, root):
        partition, _ = _read_partition(bound, root)
        actual = partition["revision"]
        if actual != expected:
            raise AppDataConflictError(expected, actual)
        previous = partition["entries"].get(validated_key)
        if previous is None:
            return {"revision": actual, "deleted": False}
        if actual >= MAX_SAFE_REVISION:
            raise ValueError("App Data partition revision is exhausted")
        del partition["entries"][validated_key]
        partition["revision"] = actual + 1
        _write_partition(partition, root)
        return {"revision": partition["revision"], "deleted": True}
