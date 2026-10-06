#!/usr/bin/env python3
"""Domain-neutral private partitioned JSON state with atomic revision CAS.

The caller owns partition identity and record semantics. This module owns only
filesystem safety, bounded canonical JSON, per-partition locks and atomic CAS.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import json
import os
import re
import secrets
import stat
import threading
from collections.abc import Callable

MAX_SAFE_REVISION = 9007199254740991
_PARTITION_STEM_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")
_STATE_LOCK = threading.RLock()

RecordValidator = Callable[[object], dict]


def _label(value: object) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("Native partitioned JSON label is invalid")
    normalized = value.strip()
    if not normalized or len(normalized) > 96:
        raise ValueError("Native partitioned JSON label is invalid")
    return normalized


def _root(value: object) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Native partitioned JSON root is invalid")
    return value


def _stem(value: object) -> str:
    if not isinstance(value, str) or not _PARTITION_STEM_RE.fullmatch(value):
        raise ValueError("Native partitioned JSON partition stem is invalid")
    return value


def _byte_limit(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 128 * 1024 * 1024:
        raise ValueError("Native partitioned JSON byte limit is invalid")
    return value


def _expected_revision(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value >= MAX_SAFE_REVISION
    ):
        raise ValueError("Native partitioned JSON expected revision is invalid")
    return value


def _record_revision(value: object, label: str) -> int:
    if not isinstance(value, dict):
        raise ValueError(f"{label} record must be an object")
    revision = value.get("revision")
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
        or revision > MAX_SAFE_REVISION
    ):
        raise ValueError(f"{label} record revision is invalid")
    return revision


def _state_name(stem: str) -> str:
    return f"{stem}.json"


def _lock_name(stem: str) -> str:
    return f"{stem}.lock"


def partition_state_path(root: object, partition_stem: object) -> str:
    normalized_root = _root(root)
    normalized_stem = _stem(partition_stem)
    return os.path.join(normalized_root, _state_name(normalized_stem))


def _assert_private_metadata(metadata: os.stat_result, label: str, *, directory: bool, domain_label: str) -> None:
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_type(metadata.st_mode):
        raise ValueError(f"{domain_label} {label} has unsafe type")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError(f"{domain_label} {label} permissions are not private")
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise ValueError(f"{domain_label} {label} ownership is unsafe")


def _ensure_root_exists(root: str) -> None:
    try:
        os.mkdir(root, mode=0o700)
    except FileExistsError:
        pass


def _open_private_root(root: str, domain_label: str) -> int:
    _ensure_root_exists(root)
    descriptor = os.open(
        root,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        _assert_private_metadata(
            os.fstat(descriptor),
            "state root",
            directory=True,
            domain_label=domain_label,
        )
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _validate_existing_target(root_fd: int, name: str, max_record_bytes: int, domain_label: str) -> None:
    try:
        metadata = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    _assert_private_metadata(
        metadata,
        "state target",
        directory=False,
        domain_label=domain_label,
    )
    if metadata.st_size > max_record_bytes:
        raise ValueError(f"{domain_label} state target exceeds byte limit")


def _read_unlocked(
    root_fd: int,
    name: str,
    max_record_bytes: int,
    validate_record: RecordValidator,
    domain_label: str,
) -> dict | None:
    _validate_existing_target(root_fd, name, max_record_bytes, domain_label)
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=root_fd,
        )
    except FileNotFoundError:
        return None
    try:
        metadata = os.fstat(descriptor)
        _assert_private_metadata(
            metadata,
            "opened state target",
            directory=False,
            domain_label=domain_label,
        )
        if metadata.st_size > max_record_bytes:
            raise ValueError(f"{domain_label} state changed to an unsafe file")
        chunks: list[bytes] = []
        remaining = max_record_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(raw) > max_record_bytes:
        raise ValueError(f"{domain_label} state exceeds byte limit")
    try:
        parsed = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{domain_label} state is corrupt") from exc
    try:
        normalized = validate_record(parsed)
    except (TypeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    _record_revision(normalized, domain_label)
    return normalized


def _encode_record(record: dict, max_record_bytes: int, domain_label: str) -> bytes:
    try:
        encoded = (
            json.dumps(
                record,
                separators=(",", ":"),
                sort_keys=True,
                ensure_ascii=False,
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ValueError(f"{domain_label} record is not canonical JSON") from exc
    if len(encoded) > max_record_bytes:
        raise ValueError(f"{domain_label} record exceeds byte limit")
    return encoded


def _write_unlocked(
    record: dict,
    root_fd: int,
    name: str,
    max_record_bytes: int,
    domain_label: str,
) -> None:
    encoded = _encode_record(record, max_record_bytes, domain_label)
    _validate_existing_target(root_fd, name, max_record_bytes, domain_label)
    temporary = f".{name}.tmp.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=root_fd,
        )
        _assert_private_metadata(
            os.fstat(descriptor),
            "temporary state target",
            directory=False,
            domain_label=domain_label,
        )
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written <= 0:
                raise OSError(f"{domain_label} state write made no progress")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, name, src_dir_fd=root_fd, dst_dir_fd=root_fd)
        os.chmod(name, 0o600, dir_fd=root_fd, follow_symlinks=False)
        _validate_existing_target(root_fd, name, max_record_bytes, domain_label)
        os.fsync(root_fd)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=root_fd)
        except FileNotFoundError:
            pass
        raise


@contextmanager
def _partition_lock(root: str, stem: str, domain_label: str, *, exclusive: bool):
    root_fd = _open_private_root(root, domain_label)
    lock_name = _lock_name(stem)
    descriptor = -1
    try:
        descriptor = os.open(
            lock_name,
            os.O_RDWR
            | os.O_CREAT
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=root_fd,
        )
        _assert_private_metadata(
            os.fstat(descriptor),
            "state lock",
            directory=False,
            domain_label=domain_label,
        )
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield root_fd
    finally:
        if descriptor >= 0:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)
        os.close(root_fd)


def read_partitioned_json_record(
    root: object,
    partition_stem: object,
    *,
    max_record_bytes: object,
    validate_record: RecordValidator,
    label: object,
) -> dict | None:
    normalized_root = _root(root)
    stem = _stem(partition_stem)
    limit = _byte_limit(max_record_bytes)
    domain_label = _label(label)
    if not callable(validate_record):
        raise ValueError("Native partitioned JSON record validator is invalid")
    with _STATE_LOCK:
        with _partition_lock(normalized_root, stem, domain_label, exclusive=False) as root_fd:
            return _read_unlocked(
                root_fd,
                _state_name(stem),
                limit,
                validate_record,
                domain_label,
            )


def compare_and_swap_partitioned_json_record(
    root: object,
    partition_stem: object,
    expected_revision: object,
    next_record: object,
    *,
    max_record_bytes: object,
    validate_record: RecordValidator,
    label: object,
) -> dict | None:
    normalized_root = _root(root)
    stem = _stem(partition_stem)
    expected = _expected_revision(expected_revision)
    limit = _byte_limit(max_record_bytes)
    domain_label = _label(label)
    if not callable(validate_record):
        raise ValueError("Native partitioned JSON record validator is invalid")
    try:
        normalized_next = validate_record(next_record)
    except (TypeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    if _record_revision(normalized_next, domain_label) != expected + 1:
        raise ValueError(f"{domain_label} CAS next revision is invalid")

    with _STATE_LOCK:
        with _partition_lock(normalized_root, stem, domain_label, exclusive=True) as root_fd:
            name = _state_name(stem)
            current = _read_unlocked(
                root_fd,
                name,
                limit,
                validate_record,
                domain_label,
            )
            current_revision = 0 if current is None else _record_revision(current, domain_label)
            if current_revision != expected:
                return None
            _write_unlocked(normalized_next, root_fd, name, limit, domain_label)
            return normalized_next
