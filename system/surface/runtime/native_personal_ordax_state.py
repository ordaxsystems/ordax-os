#!/usr/bin/env python3
"""Private atomic Native owner for Personal OrdaX Work/Activity/Result state."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import secrets
import stat
import threading

RECORD_SCHEMA = "ordax.native-personal-ordax-record/1"
STORE_STATE_SCHEMA = "ordax.personal-work-store-state/1"
DEFAULT_PERSONAL_ORDAX_STATE_ROOT = "/var/lib/ordax/personal-ordax"
MAX_PERSONAL_STATE_PAYLOAD_BYTES = 4 * 1024 * 1024
MAX_PERSONAL_RECORD_BYTES = 6 * MAX_PERSONAL_STATE_PAYLOAD_BYTES + 4096
MAX_WORK_ITEMS = 32
MAX_ACTIVITY_EVENTS = 512
MAX_RESULTS = 32
MAX_APPROVALS = 64
MAX_DECISIONS = 64
MAX_ATTEMPTS = 128

_STATE_LOCK = threading.RLock()
_OWNER_KINDS = frozenset(("device", "account"))
_STATE_KEYS = frozenset((
    "schema", "ownerKind", "ownerId", "nextOrdinal", "workItems", "activities",
    "results", "approvals", "decisions", "attempts",
))


def _text(value: object, label: str, max_chars: int) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError(f"{label} is invalid")
    normalized = value.strip()
    if not normalized or len(normalized) > max_chars:
        raise ValueError(f"{label} is invalid")
    return normalized


def normalize_owner(owner_kind: object, owner_id: object = None) -> tuple[str, str | None]:
    if owner_kind not in _OWNER_KINDS:
        raise ValueError("Personal OrdaX owner kind is invalid")
    if owner_kind == "device":
        if owner_id is not None:
            raise ValueError("Device Personal OrdaX owner cannot carry account id")
        return "device", None
    return "account", _text(owner_id, "Personal OrdaX owner id", 160)


def _owner_stem(owner_kind: str, owner_id: str | None) -> str:
    if owner_kind == "device":
        return "device"
    digest = hashlib.sha256(owner_id.encode("utf-8")).hexdigest()
    return f"account-{digest}"


def _state_name(owner_kind: str, owner_id: str | None) -> str:
    return f"{_owner_stem(owner_kind, owner_id)}.json"


def _lock_name(owner_kind: str, owner_id: str | None) -> str:
    return f"{_owner_stem(owner_kind, owner_id)}.lock"


def _state_path(root: str, owner_kind: str, owner_id: str | None) -> str:
    return os.path.join(root, _state_name(owner_kind, owner_id))


def _assert_private_metadata(metadata: os.stat_result, label: str, *, directory: bool) -> None:
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_type(metadata.st_mode):
        raise ValueError(f"Personal OrdaX Native {label} has unsafe type")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError(f"Personal OrdaX Native {label} permissions are not private")
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise ValueError(f"Personal OrdaX Native {label} ownership is unsafe")


def _ensure_root_exists(root: str) -> None:
    try:
        os.mkdir(root, mode=0o700)
    except FileExistsError:
        pass


def _open_private_root(root: str) -> int:
    _ensure_root_exists(root)
    descriptor = os.open(
        root,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        _assert_private_metadata(os.fstat(descriptor), "state root", directory=True)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _bounded_array(state: dict, key: str, maximum: int) -> list:
    value = state.get(key)
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"Personal OrdaX {key} is invalid or unbounded")
    return value


def _assert_authority_none(value: object) -> None:
    if isinstance(value, dict):
        if "authority" in value and value["authority"] != "none":
            raise ValueError("Personal OrdaX persisted authority must remain none")
        for child in value.values():
            _assert_authority_none(child)
    elif isinstance(value, list):
        for child in value:
            _assert_authority_none(child)


def validate_personal_payload(
    payload: object,
    owner_kind: object,
    owner_id: object = None,
) -> str:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    if not isinstance(payload, str):
        raise ValueError("Personal OrdaX payload must be UTF-8 JSON text")
    encoded = payload.encode("utf-8")
    if len(encoded) > MAX_PERSONAL_STATE_PAYLOAD_BYTES:
        raise ValueError("Personal OrdaX payload exceeds byte limit")
    try:
        state = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("Personal OrdaX payload is invalid JSON") from exc
    if not isinstance(state, dict) or set(state) != _STATE_KEYS:
        raise ValueError("Personal OrdaX payload shape is invalid")
    if state.get("schema") != STORE_STATE_SCHEMA:
        raise ValueError("Personal OrdaX payload schema is incompatible")
    if state.get("ownerKind") != owner_kind or state.get("ownerId") != owner_id:
        raise ValueError("Personal OrdaX payload owner binding mismatch")
    next_ordinal = state.get("nextOrdinal")
    if isinstance(next_ordinal, bool) or not isinstance(next_ordinal, int) or next_ordinal < 1:
        raise ValueError("Personal OrdaX next ordinal is invalid")

    work_items = _bounded_array(state, "workItems", MAX_WORK_ITEMS)
    _bounded_array(state, "activities", MAX_ACTIVITY_EVENTS)
    _bounded_array(state, "results", MAX_RESULTS)
    _bounded_array(state, "approvals", MAX_APPROVALS)
    _bounded_array(state, "decisions", MAX_DECISIONS)
    _bounded_array(state, "attempts", MAX_ATTEMPTS)

    for work in work_items:
        if not isinstance(work, dict):
            raise ValueError("Personal OrdaX work item is invalid")
        if work.get("ownerKind") != owner_kind or work.get("ownerId") != owner_id:
            raise ValueError("Personal OrdaX work crosses owner partition")
        if work.get("backgroundExecution") is not False:
            raise ValueError("Personal OrdaX public background execution remains disabled")

    _assert_authority_none(state)
    normalized = json.dumps(
        state,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    )
    if len(normalized.encode("utf-8")) > MAX_PERSONAL_STATE_PAYLOAD_BYTES:
        raise ValueError("Personal OrdaX normalized payload exceeds byte limit")
    return normalized


def _validate_record(value: object, owner_kind: str, owner_id: str | None) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "$schema", "revision", "ownerKind", "ownerId", "payload"
    }:
        raise ValueError("Personal OrdaX Native record shape is invalid")
    if value.get("$schema") != RECORD_SCHEMA:
        raise ValueError("Personal OrdaX Native record schema is incompatible")
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1 or revision > 9007199254740991:
        raise ValueError("Personal OrdaX Native record revision is invalid")
    if value.get("ownerKind") != owner_kind or value.get("ownerId") != owner_id:
        raise ValueError("Personal OrdaX Native record owner binding mismatch")
    payload = validate_personal_payload(value.get("payload"), owner_kind, owner_id)
    return {
        "$schema": RECORD_SCHEMA,
        "revision": revision,
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "payload": payload,
    }


def _validate_existing_target(root_fd: int, name: str) -> None:
    try:
        metadata = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    _assert_private_metadata(metadata, "state target", directory=False)
    if metadata.st_size > MAX_PERSONAL_RECORD_BYTES:
        raise ValueError("Personal OrdaX Native state target exceeds byte limit")


def _read_unlocked(
    root_fd: int,
    name: str,
    owner_kind: str,
    owner_id: str | None,
) -> dict | None:
    _validate_existing_target(root_fd, name)
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=root_fd,
        )
    except FileNotFoundError:
        return None
    try:
        metadata = os.fstat(descriptor)
        _assert_private_metadata(metadata, "opened state target", directory=False)
        if metadata.st_size > MAX_PERSONAL_RECORD_BYTES:
            raise ValueError("Personal OrdaX Native state changed to an unsafe file")
        chunks: list[bytes] = []
        remaining = MAX_PERSONAL_RECORD_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_PERSONAL_RECORD_BYTES:
        raise ValueError("Personal OrdaX Native state exceeds byte limit")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Personal OrdaX Native state is corrupt") from exc
    return _validate_record(value, owner_kind, owner_id)


def _write_unlocked(record: dict, root_fd: int, name: str) -> None:
    encoded = (
        json.dumps(record, separators=(",", ":"), sort_keys=True, ensure_ascii=False, allow_nan=False)
        + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_PERSONAL_RECORD_BYTES:
        raise ValueError("Personal OrdaX Native record exceeds byte limit")
    _validate_existing_target(root_fd, name)
    temporary = f".{name}.tmp.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=root_fd,
        )
        metadata = os.fstat(descriptor)
        _assert_private_metadata(metadata, "temporary state target", directory=False)
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written <= 0:
                raise OSError("Personal OrdaX Native state write made no progress")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, name, src_dir_fd=root_fd, dst_dir_fd=root_fd)
        os.chmod(name, 0o600, dir_fd=root_fd, follow_symlinks=False)
        _validate_existing_target(root_fd, name)
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
def _partition_lock(root: str, owner_kind: str, owner_id: str | None, *, exclusive: bool):
    root_fd = _open_private_root(root)
    lock_name = _lock_name(owner_kind, owner_id)
    descriptor = -1
    try:
        descriptor = os.open(
            lock_name,
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=root_fd,
        )
        metadata = os.fstat(descriptor)
        _assert_private_metadata(metadata, "state lock", directory=False)
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield root_fd
    finally:
        if descriptor >= 0:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)
        os.close(root_fd)


def read_personal_ordax_record(
    owner_kind: object,
    owner_id: object = None,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    name = _state_name(owner_kind, owner_id)
    with _STATE_LOCK:
        with _partition_lock(root, owner_kind, owner_id, exclusive=False) as root_fd:
            return _read_unlocked(root_fd, name, owner_kind, owner_id)


def compare_and_swap_personal_ordax_payload(
    owner_kind: object,
    owner_id: object,
    expected_revision: object,
    payload: object,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
        or expected_revision > 9007199254740990
    ):
        raise ValueError("Personal OrdaX expected revision is invalid")
    payload = validate_personal_payload(payload, owner_kind, owner_id)
    name = _state_name(owner_kind, owner_id)
    with _STATE_LOCK:
        with _partition_lock(root, owner_kind, owner_id, exclusive=True) as root_fd:
            current = _read_unlocked(root_fd, name, owner_kind, owner_id)
            current_revision = 0 if current is None else current["revision"]
            if current_revision != expected_revision:
                return None
            record = {
                "$schema": RECORD_SCHEMA,
                "revision": expected_revision + 1,
                "ownerKind": owner_kind,
                "ownerId": owner_id,
                "payload": payload,
            }
            _write_unlocked(record, root_fd, name)
            return record
