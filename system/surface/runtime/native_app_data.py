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
APP_DATA_CHECKPOINT_SCHEMA = "ordax.native-app-data-checkpoint/1"
APP_DATA_CHECKPOINT_NAME = "checkpoint.json"
APP_DATA_OWNER_SCOPE = "device"
DEFAULT_APP_DATA_ROOT = "/var/lib/ordax/app-data/v1"
DEFAULT_APP_DATA_QUOTA_BYTES = 8 * 1024 * 1024
DEFAULT_APP_DATA_MAX_KEYS = 1024
MAX_APP_DATA_VALUE_BYTES = 1024 * 1024
MAX_APP_DATA_PARTITION_BYTES = 64 * 1024 * 1024
MAX_APP_DATA_PARTITION_KEYS = 4096
MAX_APP_DATA_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_APP_DATA_CHECKPOINT_BYTES = MAX_APP_DATA_MANIFEST_BYTES + 4096
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
    if not _validate_private_directory(blobs, "App Data blob directory"):
        # After first materialization, blobs are part of the durable
        # partition, even if the current generation has zero entries.
        # Recreating a disappeared directory could make a healthy manifest
        # point to missing data without noticing the storage failure.
        raise ValueError("App Data blob directory is missing from existing partition")
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
        # A partition that already exists is not an authoritative empty
        # generation. If its manifest vanished, silently returning revision
        # zero could let the next CAS write discard previously persisted data.
        raise ValueError("App Data manifest is missing from existing partition")
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


def _source_release(value: object, identity: dict) -> dict:
    # Only the trusted Native activation owner may supply this reference.
    # Its shape is NOT cryptographic proof or activation authority.
    if not isinstance(value, dict) or set(value) != {"componentId", "version", "sourceCommit"}:
        raise ValueError("App Data checkpoint source release shape is invalid")
    if value["componentId"] != identity["appId"]:
        raise ValueError("App Data checkpoint release does not match partition identity")
    version = value["version"]
    if (
        not isinstance(version, str)
        or len(version) > 128
        or not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.+-]+)?", version)
    ):
        raise ValueError("App Data checkpoint source version is invalid")
    source_commit = value["sourceCommit"]
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("App Data checkpoint source commit is invalid")
    return {"componentId": identity["appId"], "version": version, "sourceCommit": source_commit}


def _checkpoint_path(root: str, identity: dict) -> str:
    return os.path.join(_partition_paths(root, identity)[0], APP_DATA_CHECKPOINT_NAME)


def _read_checkpoint(identity: dict, root: str) -> dict | None:
    paths = _existing_partition_paths(root, identity)
    if paths is None:
        return None
    partition, _, _, _ = paths
    target = os.path.join(partition, APP_DATA_CHECKPOINT_NAME)
    if not os.path.lexists(target):
        return None
    raw = _read_regular_file(target, "App Data checkpoint", MAX_APP_DATA_CHECKPOINT_BYTES)
    try:
        document = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("App Data checkpoint is corrupt") from exc
    if (
        not isinstance(document, dict)
        or set(document) != {"$schema", "identity", "sourceRelease", "manifest"}
        or document["$schema"] != APP_DATA_CHECKPOINT_SCHEMA
        or _identity(document["identity"]) != identity
    ):
        raise ValueError("App Data checkpoint identity or schema is invalid")
    release = _source_release(document["sourceRelease"], identity)
    manifest, _ = _validate_manifest(document["manifest"], identity)
    # Revision zero is the canonical empty pre-first-write generation.
    # A forged zero-revision pin containing data is never a valid genesis.
    if manifest["revision"] == 0 and manifest["entries"]:
        raise ValueError("App Data checkpoint zero revision has unexpected entries")
    return {
        "$schema": APP_DATA_CHECKPOINT_SCHEMA,
        "identity": dict(identity),
        "sourceRelease": release,
        "manifest": manifest,
    }


def _verify_checkpoint_blobs(root: str, checkpoint: dict) -> None:
    paths = _existing_partition_paths(root, checkpoint["identity"])
    if paths is None:
        raise ValueError("App Data checkpoint partition is unavailable")
    _, _, _, blobs = paths
    if not _validate_private_directory(blobs, "App Data blob directory"):
        raise ValueError("App Data checkpoint blobs are unavailable")
    # Validate all retained bytes before committing a restore or pin.
    for entry in checkpoint["manifest"]["entries"].values():
        _verify_blob(blobs, entry)


def create_app_data_checkpoint(
    identity: object,
    source_release: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
) -> dict:
    """Trusted-owner-only checkpoint, never part of the application API."""
    bound = _identity(identity)
    release = _source_release(source_release, bound)
    expected = _revision(expected_revision)
    with _exclusive_partition_lock(bound, root):
        current, _ = _read_manifest(bound, root)
        if current["revision"] != expected:
            raise AppDataConflictError(expected, current["revision"])
        # A new partition has a real recoverable empty generation (rev 0).
        # The lock creates its private directory before this read; pinning
        # genesis lets a first stateful update recover without invented data.
        if current["revision"] == 0 and current["entries"]:
            raise ValueError("App Data empty generation contains unexpected entries")
        if _read_checkpoint(bound, root) is not None:
            raise ValueError("App Data already has a retained recovery checkpoint")
        checkpoint = {
            "$schema": APP_DATA_CHECKPOINT_SCHEMA,
            "identity": dict(bound),
            "sourceRelease": release,
            "manifest": current,
        }
        _verify_checkpoint_blobs(root, checkpoint)
        raw = json.dumps(checkpoint, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")
        if len(raw) > MAX_APP_DATA_CHECKPOINT_BYTES:
            raise ValueError("App Data checkpoint exceeds hard bound")
        partition, _, _, _ = _ensure_partition_directories(root, bound)
        _atomic_replace_bytes(
            os.path.join(partition, APP_DATA_CHECKPOINT_NAME),
            partition, raw, label="App Data checkpoint",
        )
        # Reopen the durable record, including its owner and release binding.
        saved = _read_checkpoint(bound, root)
        if saved != checkpoint:
            raise ValueError("App Data checkpoint failed durable readback")
        return {"pinnedRevision": current["revision"], "sourceRelease": release}


def inspect_app_data_checkpoint(
    identity: object,
    source_release: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
) -> dict:
    """Read-only owner inspection, never activation proof or an app endpoint.

    This checks the actual persisted current and pinned bytes under the
    partition's shared flock. The returned digest and release correlation
    are deliberately not a signature and cannot authorize a Go stateful
    activation or rollback after the lock has been released.
    """
    bound = _identity(identity)
    release = _source_release(source_release, bound)
    expected = _revision(expected_revision)
    with _shared_partition_lock_if_present(bound, root) as locked:
        if not locked:
            raise ValueError("App Data checkpoint partition or lock is unavailable")
        current, _ = _read_manifest(bound, root)
        if current["revision"] != expected:
            raise AppDataConflictError(expected, current["revision"])
        checkpoint = _read_checkpoint(bound, root)
        if checkpoint is None or checkpoint["sourceRelease"] != release:
            raise ValueError("App Data verified checkpoint for source release is unavailable")
        pinned_revision = checkpoint["manifest"]["revision"]
        if pinned_revision > current["revision"]:
            raise ValueError("App Data checkpoint revision exceeds current generation")
        # Verify both generations before returning a diagnostic snapshot.
        # This does not grant a lease over the content after releasing flock.
        paths = _existing_partition_paths(root, bound)
        if paths is None:
            raise ValueError("App Data checkpoint partition disappeared")
        _, manifest_path, _, blobs = paths
        for entry in current["entries"].values():
            _verify_blob(blobs, entry)
        _verify_checkpoint_blobs(root, checkpoint)
        # Both digests come from the actual disk bytes while holding flock,
        # not a reserialized/reconstructed JSON snapshot. The current
        # manifest must still decode as the version validated above.
        current_bytes = _read_regular_file(
            manifest_path, "App Data manifest", MAX_APP_DATA_MANIFEST_BYTES,
        )
        try:
            current_on_disk = json.loads(current_bytes.decode("utf-8", errors="strict"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("App Data manifest is corrupt") from exc
        if _validate_manifest(current_on_disk, bound)[0] != current:
            raise ValueError("App Data current manifest changed during inspection")
        persisted = _read_regular_file(
            _checkpoint_path(root, bound),
            "App Data checkpoint", MAX_APP_DATA_CHECKPOINT_BYTES,
        )
        return {
            "authority": "none",
            "identity": dict(bound),
            "sourceRelease": release,
            "pinnedRevision": pinned_revision,
            "currentRevision": current["revision"],
            "currentManifestSHA256": hashlib.sha256(current_bytes).hexdigest(),
            "checkpointSHA256": hashlib.sha256(persisted).hexdigest(),
        }


def restore_app_data_checkpoint(
    identity: object,
    source_release: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
) -> dict:
    """Rewind bytes only through explicit trusted-owner recovery and CAS.

    The authoritative manifest revision remains monotonic; a restore does
    not silently rewrite user data or grant permission to switch releases.
    """
    bound = _identity(identity)
    release = _source_release(source_release, bound)
    expected = _revision(expected_revision)
    with _exclusive_partition_lock(bound, root):
        current, _ = _read_manifest(bound, root)
        if current["revision"] != expected:
            raise AppDataConflictError(expected, current["revision"])
        checkpoint = _read_checkpoint(bound, root)
        if checkpoint is None or checkpoint["sourceRelease"] != release:
            raise ValueError("App Data verified checkpoint for source release is unavailable")
        if checkpoint["manifest"]["revision"] > current["revision"]:
            raise ValueError("App Data checkpoint revision exceeds current generation")
        if current["revision"] >= MAX_SAFE_REVISION:
            raise ValueError("App Data partition revision is exhausted")
        _verify_checkpoint_blobs(root, checkpoint)
        restored = dict(checkpoint["manifest"])
        restored["revision"] = current["revision"] + 1
        # Blobs are immutable, already fully verified and kept by the pin.
        # Atomic manifest replacement is the only authoritative switch.
        _write_manifest(restored, root)
        _cleanup_unreferenced_blobs(restored, root)
        return {
            "revision": restored["revision"],
            "restoredFromRevision": checkpoint["manifest"]["revision"],
            "restored": True,
        }


def retire_app_data_checkpoint(
    identity: object,
    source_release: object,
    expected_revision: object,
    root: str = DEFAULT_APP_DATA_ROOT,
) -> dict:
    """Explicit trusted-owner retention decision, not an app data action."""
    bound = _identity(identity)
    release = _source_release(source_release, bound)
    expected = _revision(expected_revision)
    with _exclusive_partition_lock(bound, root):
        current, _ = _read_manifest(bound, root)
        if current["revision"] != expected:
            raise AppDataConflictError(expected, current["revision"])
        checkpoint = _read_checkpoint(bound, root)
        if checkpoint is None or checkpoint["sourceRelease"] != release:
            raise ValueError("App Data verified checkpoint for source release is unavailable")
        partition, _, _, _ = _ensure_partition_directories(root, bound)
        os.unlink(os.path.join(partition, APP_DATA_CHECKPOINT_NAME))
        descriptor = os.open(
            partition, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        # Garbage collection happens only *after* durable retirement.
        _cleanup_unreferenced_blobs(current, root)
        return {"revision": current["revision"], "retired": True}


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
    checkpoint = _read_checkpoint(manifest["identity"], root)
    if checkpoint is not None:
        referenced.update(record["blob"] for record in checkpoint["manifest"]["entries"].values())
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
    # Determine genesis before creating anything. Existing partitions must
    # never be silently reconstructed after a missing/corrupt manifest.
    was_present = _existing_partition_paths(root, identity) is not None
    partition, manifest_path, lock_path, _ = _ensure_partition_directories(root, identity)
    if not os.path.lexists(lock_path) and was_present:
        # Never replace the lock identity of an existing partition: another
        # process may still hold the unlinked inode and think it has exclusive
        # ownership. Creating a new lock file would split that authority.
        raise ValueError("App Data partition lock is missing")
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
        if not os.path.lexists(manifest_path):
            if was_present:
                raise ValueError("App Data manifest is missing from existing partition")
            # Persist canonical revision zero before exposing a writable
            # partition. A crash after this fsync has a real genesis
            # manifest; a crash before it cannot be confused with recovery.
            _write_manifest(_empty_manifest(identity), root)
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
        # A damaged recovery pin may never be bypassed by a new mutation.
        _read_checkpoint(bound, root)
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
        # Keep the rollback horizon intact even during ordinary deletion.
        _read_checkpoint(bound, root)
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
