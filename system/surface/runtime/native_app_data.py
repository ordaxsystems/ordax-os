#!/usr/bin/env python3
"""Private atomic Native persistence for sandboxed App Data partitions.

The authoritative state is a small per-partition manifest. Values are immutable,
content-addressed blobs. A mutation writes/verifies blobs first, then atomically
switches the manifest, so crashes never make an uncommitted blob authoritative.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat

APP_DATA_PARTITION_SCHEMA = "ordax.native-app-data-partition/2"
APP_DATA_OWNER_SCOPE = "device"
DEFAULT_APP_DATA_ROOT = "/var/lib/ordax/app-data/v1"
DEFAULT_APP_DATA_QUOTA_BYTES = 8 * 1024 * 1024
DEFAULT_APP_DATA_MAX_KEYS = 1024
MAX_APP_DATA_VALUE_BYTES = 1024 * 1024
MAX_APP_DATA_PARTITION_BYTES = 64 * 1024 * 1024
MAX_APP_DATA_PARTITION_KEYS = 4096
MAX_APP_DATA_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_APP_DATA_KEY_CHARS = 128
MAX_SAFE_REVISION = 9007199254740991

_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_PUBLISHER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{0,119}$")
_KEY_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


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


def _partition_paths(root: str, identity: dict) -> tuple[str, str, str, str]:
    partition = os.path.join(root, _partition_digest(identity))
    return partition, os.path.join(partition, "manifest.json"), os.path.join(partition, "lock"), os.path.join(partition, "blobs")


def _validate_absolute_root(root: str) -> None:
    if not isinstance(root, str) or not root or "\x00" in root or not os.path.isabs(root):
        raise ValueError("App Data root is invalid")


def _validate_private_directory(path: str, label: str) -> bool:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError(f"{label} is not a real directory")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError(f"{label} permissions are not private")
    return True


def _create_private_directory(path: str, parent: str, label: str) -> None:
    if _validate_private_directory(path, label):
        return
    parent_metadata = os.lstat(parent)
    if not stat.S_ISDIR(parent_metadata.st_mode) or stat.S_ISLNK(parent_metadata.st_mode):
        raise ValueError(f"{label} parent is unsafe")
    os.mkdir(path, 0o700)
    directory = os.open(parent, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    if not _validate_private_directory(path, label):
        raise ValueError(f"{label} was not created safely")


def _ensure_partition_directories(root: str, identity: dict) -> tuple[str, str, str, str]:
    _validate_absolute_root(root)
    if not _validate_private_directory(root, "App Data root"):
        _create_private_directory(root, os.path.dirname(root), "App Data root")
    partition, manifest, lock, blobs = _partition_paths(root, identity)
    if not _validate_private_directory(partition, "App Data partition directory"):
        _create_private_directory(partition, root, "App Data partition directory")
    if not _validate_private_directory(blobs, "App Data blob directory"):
        _create_private_directory(blobs, partition, "App Data blob directory")
    return partition, manifest, lock, blobs


def _existing_partition_paths(root: str, identity: dict) -> tuple[str, str, str, str] | None:
    _validate_absolute_root(root)
    if not _validate_private_directory(root, "App Data root"):
        return None
    paths = _partition_paths(root, identity)
    partition, _, _, blobs = paths
    if not _validate_private_directory(partition, "App Data partition directory"):
        return None
    if os.path.lexists(blobs) and not _validate_private_directory(blobs, "App Data blob directory"):
        raise ValueError("App Data blob directory is unsafe")
    return paths


def _validate_private_regular(path: str, label: str, max_bytes: int | None = None) -> bool:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError(f"{label} is unsafe")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError(f"{label} permissions are not private")
    if max_bytes is not None and metadata.st_size > max_bytes:
        raise ValueError(f"{label} exceeds hard bound")
    return True


def _read_regular_file(path: str, label: str, max_bytes: int) -> bytes:
    if not _validate_private_regular(path, label, max_bytes):
        raise ValueError(f"{label} is missing")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > max_bytes:
            raise ValueError(f"{label} changed to an unsafe file")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > max_bytes:
            raise ValueError(f"{label} exceeds hard bound")
        return payload
    finally:
        os.close(descriptor)


def _empty_manifest(identity: dict) -> dict:
    return {"$schema": APP_DATA_PARTITION_SCHEMA, "identity": dict(identity), "revision": 0, "entries": {}}


def _validate_manifest(value: object, expected_identity: dict) -> tuple[dict, int]:
    if not isinstance(value, dict) or set(value) != {"$schema", "identity", "revision", "entries"}:
        raise ValueError("App Data manifest shape is invalid")
    if value.get("$schema") != APP_DATA_PARTITION_SCHEMA:
        raise ValueError("App Data manifest schema is invalid")
    identity = _identity(value.get("identity"))
    if identity != expected_identity:
        raise ValueError("App Data partition identity binding mismatch")
    revision = _revision(value.get("revision"))
    raw_entries = value.get("entries")
    if not isinstance(raw_entries, dict) or len(raw_entries) > MAX_APP_DATA_PARTITION_KEYS:
        raise ValueError("App Data manifest entries are invalid or unbounded")
    entries: dict[str, dict] = {}
    bytes_used = 0
    for raw_key, record in raw_entries.items():
        key = _key(raw_key)
        if not isinstance(record, dict) or set(record) != {"blob", "size"}:
            raise ValueError("App Data manifest record is invalid")
        digest = record.get("blob")
        size = record.get("size")
        if not isinstance(digest, str) or not _DIGEST_RE.fullmatch(digest):
            raise ValueError("App Data blob digest is invalid")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0 or size > MAX_APP_DATA_VALUE_BYTES:
            raise ValueError("App Data blob size is invalid")
        bytes_used += size
        if bytes_used > MAX_APP_DATA_PARTITION_BYTES:
            raise ValueError("App Data partition bytes exceed hard bound")
        entries[key] = {"blob": digest, "size": size}
    return {"$schema": APP_DATA_PARTITION_SCHEMA, "identity": identity, "revision": revision, "entries": entries}, bytes_used


def _read_manifest(identity: dict, root: str) -> tuple[dict, int]:
    paths = _existing_partition_paths(root, identity)
    if paths is None:
        return _empty_manifest(identity), 0
    _, manifest_path, _, _ = paths
    if not os.path.lexists(manifest_path):
        return _empty_manifest(identity), 0
    payload = _read_regular_file(manifest_path, "App Data manifest", MAX_APP_DATA_MANIFEST_BYTES)
    try:
        parsed = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("App Data manifest is corrupt") from exc
    return _validate_manifest(parsed, identity)


def _encode_manifest(manifest: dict) -> bytes:
    payload = {
        "$schema": APP_DATA_PARTITION_SCHEMA,
        "identity": dict(manifest["identity"]),
        "revision": manifest["revision"],
        "entries": {key: dict(value) for key, value in sorted(manifest["entries"].items())},
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_APP_DATA_MANIFEST_BYTES:
        raise ValueError("App Data manifest exceeds hard bound")
    return encoded


def _atomic_replace_bytes(path: str, parent: str, payload: bytes, *, label: str) -> None:
    if os.path.lexists(path):
        _validate_private_regular(path, label)
    temp_path = os.path.join(parent, f".tmp-{os.getpid()}-{secrets.token_hex(16)}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temp_path, flags, 0o600)
    try:
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise OSError(f"short write while persisting {label}")
            offset += written
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
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
        os.replace(temp_path, path)
        directory = os.open(parent, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
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


def _blob_path(blobs: str, digest: str) -> str:
    if not _DIGEST_RE.fullmatch(digest):
        raise ValueError("App Data blob digest is invalid")
    return os.path.join(blobs, f"{digest}.bin")


def _verify_blob(blobs: str, record: dict) -> bytes:
    path = _blob_path(blobs, record["blob"])
    payload = _read_regular_file(path, "App Data blob", MAX_APP_DATA_VALUE_BYTES)
    if len(payload) != record["size"] or hashlib.sha256(payload).hexdigest() != record["blob"]:
        raise ValueError("App Data blob integrity check failed")
    return payload


def _ensure_blob(blobs: str, payload: bytes) -> dict:
    digest = hashlib.sha256(payload).hexdigest()
    record = {"blob": digest, "size": len(payload)}
    path = _blob_path(blobs, digest)
    if os.path.lexists(path):
        _verify_blob(blobs, record)
        return record
    _atomic_replace_bytes(path, blobs, payload, label="App Data blob")
    _verify_blob(blobs, record)
    return record


def _write_manifest(manifest: dict, root: str) -> None:
    partition, manifest_path, _, _ = _ensure_partition_directories(root, manifest["identity"])
    _atomic_replace_bytes(manifest_path, partition, _encode_manifest(manifest), label="App Data manifest")


def _cleanup_unreferenced_blobs(manifest: dict, root: str) -> None:
    paths = _existing_partition_paths(root, manifest["identity"])
    if paths is None:
        return
    _, _, _, blobs = paths
    if not _validate_private_directory(blobs, "App Data blob directory"):
        return
    referenced = {record["blob"] for record in manifest["entries"].values()}
    changed = False
    with os.scandir(blobs) as iterator:
        for entry in iterator:
            match = re.fullmatch(r"([0-9a-f]{64})\.bin", entry.name)
            if match is None:
                if entry.name.startswith(".tmp-"):
                    try:
                        metadata = os.lstat(entry.path)
                        if stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
                            os.unlink(entry.path)
                            changed = True
                            continue
                    except FileNotFoundError:
                        continue
                raise ValueError("App Data blob directory contains an unexpected entry")
            if match.group(1) not in referenced:
                _validate_private_regular(entry.path, "App Data orphan blob", MAX_APP_DATA_VALUE_BYTES)
                os.unlink(entry.path)
                changed = True
    if changed:
        directory = os.open(blobs, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


@contextmanager
def _shared_partition_lock_if_present(identity: dict, root: str):
    paths = _existing_partition_paths(root, identity)
    if paths is None:
        yield False
        return
    _, manifest_path, lock_path, _ = paths
    if not os.path.lexists(lock_path):
        if os.path.lexists(manifest_path):
            raise ValueError("App Data partition lock is missing")
        yield False
        return
    _validate_private_regular(lock_path, "App Data partition lock")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock_path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError("App Data partition lock is unsafe")
        fcntl.flock(descriptor, fcntl.LOCK_SH)
        yield True
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


@contextmanager
def _exclusive_partition_lock(identity: dict, root: str):
    partition, _, lock_path, _ = _ensure_partition_directories(root, identity)
    if os.path.lexists(lock_path):
        _validate_private_regular(lock_path, "App Data partition lock")
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError("App Data partition lock is unsafe")
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield partition
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def read_app_data(identity: object, key: object, root: str = DEFAULT_APP_DATA_ROOT) -> dict:
    bound = _identity(identity)
    validated_key = _key(key)
    with _shared_partition_lock_if_present(bound, root) as locked:
        if not locked:
            return {"revision": 0, "found": False, "key": validated_key, "value": None}
        manifest, _ = _read_manifest(bound, root)
        record = manifest["entries"].get(validated_key)
        if record is None:
            return {"revision": manifest["revision"], "found": False, "key": validated_key, "value": None}
        paths = _existing_partition_paths(root, bound)
        if paths is None:
            raise ValueError("App Data partition disappeared during read")
        _, _, _, blobs = paths
        value = _verify_blob(blobs, record)
        return {"revision": manifest["revision"], "found": True, "key": validated_key, "value": value}


def list_app_data(
    identity: object,
    root: str = DEFAULT_APP_DATA_ROOT,
    *,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    quota_bytes, max_keys = _quota(quota_bytes, max_keys)
    bound = _identity(identity)
    manifest, bytes_used = _read_manifest(bound, root)
    return {
        "revision": manifest["revision"],
        "keys": sorted(manifest["entries"]),
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
        manifest, bytes_used = _read_manifest(bound, root)
        actual = manifest["revision"]
        if actual != expected:
            raise AppDataConflictError(expected, actual)
        previous = manifest["entries"].get(validated_key)
        if previous is None and len(manifest["entries"]) >= max_keys:
            raise ValueError("App Data partition key quota exceeded")
        next_bytes = bytes_used - (0 if previous is None else previous["size"]) + len(payload)
        if next_bytes > quota_bytes:
            raise ValueError("App Data partition byte quota exceeded")
        if actual >= MAX_SAFE_REVISION:
            raise ValueError("App Data partition revision is exhausted")
        _, _, _, blobs = _ensure_partition_directories(root, bound)
        record = _ensure_blob(blobs, payload)
        manifest["entries"][validated_key] = record
        manifest["revision"] = actual + 1
        _write_manifest(manifest, root)
        _cleanup_unreferenced_blobs(manifest, root)
        return {"revision": manifest["revision"], "stored": True}


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
        manifest, _ = _read_manifest(bound, root)
        actual = manifest["revision"]
        if actual != expected:
            raise AppDataConflictError(expected, actual)
        if validated_key not in manifest["entries"]:
            return {"revision": actual, "deleted": False}
        if actual >= MAX_SAFE_REVISION:
            raise ValueError("App Data partition revision is exhausted")
        del manifest["entries"][validated_key]
        manifest["revision"] = actual + 1
        _write_manifest(manifest, root)
        _cleanup_unreferenced_blobs(manifest, root)
        return {"revision": manifest["revision"], "deleted": True}
