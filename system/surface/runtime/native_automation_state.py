#!/usr/bin/env python3
"""Private atomic Native persistence for OrdaX background/scheduler metadata."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
import re
import secrets
import stat
import threading
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

AUTOMATION_STATE_SCHEMA = "ordax.native-automation-state/1"
BACKGROUND_RUN_SCHEMA = "ordax.background-run/1"
BACKGROUND_CHECKPOINT_SCHEMA = "ordax.background-checkpoint/1"
SCHEDULE_SCHEMA = "ordax.schedule/1"
SCHEDULE_OCCURRENCE_SCHEMA = "ordax.schedule-occurrence/1"
DEFAULT_AUTOMATION_STATE_FILE = "/var/lib/ordax/automation-state.json"
MAX_AUTOMATION_STATE_BYTES = 8 * 1024 * 1024
MAX_BACKGROUND_RUNS = 1024
MAX_SCHEDULES = 1024
MAX_PENDING_OCCURRENCES = 2048

_OWNER_KINDS = frozenset(("device", "account"))
_BACKGROUND_STATES = frozenset(("queued", "running", "paused", "cancelled", "completed", "failed"))
_TIMESTAMP_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
_STATE_LOCK = threading.RLock()

_BACKGROUND_KEYS = frozenset((
    "schema", "revision", "runId", "consumerId", "subjectId", "ownerKind", "ownerId",
    "spaceId", "projectId", "state", "budgets", "usage", "createdAt", "startedAt",
    "deadlineAt", "lease", "checkpoint", "cancelRequestedAt", "finishedAt", "failureCode",
    "authority",
))
_SCHEDULE_KEYS = frozenset((
    "schema", "revision", "scheduleId", "consumerId", "subjectId", "ownerKind", "ownerId",
    "spaceId", "projectId", "timezone", "recurrence", "nextRunAt", "lastRunAt", "maxRuns",
    "runCount", "enabled", "deduplicationKey", "createdAt", "authority",
))
_OCCURRENCE_KEYS = frozenset((
    "schema", "occurrenceId", "scheduleId", "consumerId", "subjectId", "sequence", "dueAt",
    "createdAt", "deduplicationKey", "authority",
))


def _text(value: object, label: str, max_chars: int) -> str:
    if not isinstance(value, str) or "\x00" in value or not value or value != value.strip() or len(value) > max_chars:
        raise ValueError(f"{label} is invalid")
    return value


def _optional_text(value: object, label: str, max_chars: int) -> str | None:
    if value is None:
        return None
    return _text(value, label, max_chars)


def _integer(value: object, label: str, *, minimum: int = 0, maximum: int = 9007199254740991) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ValueError(f"{label} is invalid")
    return value


def _timestamp(value: object, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    value = _text(value, label, 64)
    if not _TIMESTAMP_RE.fullmatch(value):
        raise ValueError(f"{label} must be canonical ISO-8601")
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError(f"{label} is invalid") from exc
    return value


def _owner(value: dict, label: str) -> tuple[str, str | None]:
    kind = value.get("ownerKind")
    if kind not in _OWNER_KINDS:
        raise ValueError(f"{label} owner kind is invalid")
    owner_id = value.get("ownerId")
    if kind == "device":
        if owner_id is not None:
            raise ValueError(f"{label} device owner must not use synthetic owner id")
        return kind, None
    return kind, _text(owner_id, f"{label} owner id", 160)


def _validate_background_run(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != _BACKGROUND_KEYS or value.get("schema") != BACKGROUND_RUN_SCHEMA:
        raise ValueError("background run shape is invalid")
    if value.get("authority") != "none":
        raise ValueError("background run cannot carry authority")
    _integer(value.get("revision"), "background revision", minimum=1)
    _text(value.get("runId"), "background run id", 160)
    _text(value.get("consumerId"), "background consumer id", 160)
    _text(value.get("subjectId"), "background subject id", 160)
    _owner(value, "background")
    _optional_text(value.get("spaceId"), "background Space id", 160)
    _optional_text(value.get("projectId"), "background project id", 160)
    state = value.get("state")
    if state not in _BACKGROUND_STATES:
        raise ValueError("background state is invalid")

    budgets = value.get("budgets")
    if not isinstance(budgets, dict) or set(budgets) != {"wallClockMs", "stepLimit", "actionLimit", "egressBytesLimit"}:
        raise ValueError("background budgets are invalid")
    _integer(budgets.get("wallClockMs"), "background wall-clock budget", minimum=1000, maximum=86400000)
    step_limit = _integer(budgets.get("stepLimit"), "background step budget", minimum=1, maximum=10000)
    action_limit = _integer(budgets.get("actionLimit"), "background action budget", maximum=1000)
    egress_limit = _integer(budgets.get("egressBytesLimit"), "background egress budget", maximum=1073741824)

    usage = value.get("usage")
    if not isinstance(usage, dict) or set(usage) != {"steps", "actions", "egressBytes"}:
        raise ValueError("background usage is invalid")
    used_steps = _integer(usage.get("steps"), "background used steps", maximum=10000)
    used_actions = _integer(usage.get("actions"), "background used actions", maximum=1000)
    used_egress = _integer(usage.get("egressBytes"), "background used egress", maximum=1073741824)
    if used_steps > step_limit or used_actions > action_limit or used_egress > egress_limit:
        raise ValueError("background usage exceeds budget")

    created = _timestamp(value.get("createdAt"), "background createdAt")
    started = _timestamp(value.get("startedAt"), "background startedAt", nullable=True)
    deadline = _timestamp(value.get("deadlineAt"), "background deadlineAt")
    if datetime.fromisoformat(deadline[:-1] + "+00:00") <= datetime.fromisoformat(created[:-1] + "+00:00"):
        raise ValueError("background deadline must follow creation")
    if started is not None and datetime.fromisoformat(started[:-1] + "+00:00") < datetime.fromisoformat(created[:-1] + "+00:00"):
        raise ValueError("background start cannot precede creation")

    lease = value.get("lease")
    if lease is not None:
        if not isinstance(lease, dict) or set(lease) != {"leaseId", "workerId", "acquiredAt", "heartbeatAt", "expiresAt"}:
            raise ValueError("background lease shape is invalid")
        _text(lease.get("leaseId"), "background lease id", 160)
        _text(lease.get("workerId"), "background worker id", 160)
        acquired = _timestamp(lease.get("acquiredAt"), "background lease acquiredAt")
        heartbeat = _timestamp(lease.get("heartbeatAt"), "background lease heartbeatAt")
        expires = _timestamp(lease.get("expiresAt"), "background lease expiresAt")
        if not (acquired <= heartbeat < expires):
            raise ValueError("background lease timestamps are inconsistent")
    if (state == "running") != (lease is not None):
        raise ValueError("background running state and lease are inconsistent")

    checkpoint = value.get("checkpoint")
    if checkpoint is not None:
        if not isinstance(checkpoint, dict) or set(checkpoint) != {"schema", "sequence", "cursor", "digest", "createdAt"}:
            raise ValueError("background checkpoint shape is invalid")
        if checkpoint.get("schema") != BACKGROUND_CHECKPOINT_SCHEMA:
            raise ValueError("background checkpoint schema is invalid")
        _integer(checkpoint.get("sequence"), "background checkpoint sequence", minimum=1)
        _optional_text(checkpoint.get("cursor"), "background checkpoint cursor", 512)
        _text(checkpoint.get("digest"), "background checkpoint digest", 128)
        _timestamp(checkpoint.get("createdAt"), "background checkpoint createdAt")

    _timestamp(value.get("cancelRequestedAt"), "background cancelRequestedAt", nullable=True)
    _timestamp(value.get("finishedAt"), "background finishedAt", nullable=True)
    _optional_text(value.get("failureCode"), "background failure code", 160)
    return value


def _validate_schedule(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != _SCHEDULE_KEYS or value.get("schema") != SCHEDULE_SCHEMA:
        raise ValueError("schedule shape is invalid")
    if value.get("authority") != "none":
        raise ValueError("schedule cannot carry authority")
    _integer(value.get("revision"), "schedule revision", minimum=1)
    _text(value.get("scheduleId"), "schedule id", 160)
    _text(value.get("consumerId"), "schedule consumer id", 160)
    _text(value.get("subjectId"), "schedule subject id", 160)
    _owner(value, "schedule")
    _optional_text(value.get("spaceId"), "schedule Space id", 160)
    _optional_text(value.get("projectId"), "schedule project id", 160)
    timezone = _text(value.get("timezone"), "schedule timezone", 96)
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("schedule timezone is invalid") from exc

    recurrence = value.get("recurrence")
    if not isinstance(recurrence, dict) or set(recurrence) != {"kind", "intervalMs"}:
        raise ValueError("schedule recurrence shape is invalid")
    kind = recurrence.get("kind")
    if kind == "once":
        if recurrence.get("intervalMs") is not None:
            raise ValueError("one-shot schedule must not have interval")
    elif kind == "fixed-interval":
        _integer(recurrence.get("intervalMs"), "schedule interval", minimum=60000, maximum=2592000000)
    else:
        raise ValueError("schedule recurrence kind is invalid")

    max_runs = _integer(value.get("maxRuns"), "schedule maxRuns", minimum=1, maximum=1000000)
    run_count = _integer(value.get("runCount"), "schedule runCount", maximum=max_runs)
    enabled = value.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError("schedule enabled must be boolean")
    if enabled and run_count >= max_runs:
        raise ValueError("exhausted schedule cannot remain enabled")
    next_run = _timestamp(value.get("nextRunAt"), "schedule nextRunAt", nullable=not enabled)
    if enabled and next_run is None:
        raise ValueError("enabled schedule requires nextRunAt")
    _timestamp(value.get("lastRunAt"), "schedule lastRunAt", nullable=True)
    _text(value.get("deduplicationKey"), "schedule deduplication key", 160)
    _timestamp(value.get("createdAt"), "schedule createdAt")
    return value


def _validate_occurrence(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != _OCCURRENCE_KEYS or value.get("schema") != SCHEDULE_OCCURRENCE_SCHEMA:
        raise ValueError("schedule occurrence shape is invalid")
    if value.get("authority") != "none":
        raise ValueError("schedule occurrence cannot carry authority")
    _text(value.get("occurrenceId"), "occurrence id", 256)
    _text(value.get("scheduleId"), "occurrence schedule id", 160)
    _text(value.get("consumerId"), "occurrence consumer id", 160)
    _text(value.get("subjectId"), "occurrence subject id", 160)
    _integer(value.get("sequence"), "occurrence sequence", minimum=1)
    _timestamp(value.get("dueAt"), "occurrence dueAt")
    _timestamp(value.get("createdAt"), "occurrence createdAt")
    _text(value.get("deduplicationKey"), "occurrence deduplication key", 256)
    return value


def _empty_state() -> dict:
    return {
        "$schema": AUTOMATION_STATE_SCHEMA,
        "generation": 0,
        "backgroundRuns": {},
        "schedules": {},
        "pendingOccurrences": {},
    }


def _validate_state(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"$schema", "generation", "backgroundRuns", "schedules", "pendingOccurrences"}:
        raise ValueError("automation state shape is invalid")
    if value.get("$schema") != AUTOMATION_STATE_SCHEMA:
        raise ValueError("automation state schema is invalid")
    _integer(value.get("generation"), "automation state generation")
    runs = value.get("backgroundRuns")
    schedules = value.get("schedules")
    pending = value.get("pendingOccurrences")
    if not isinstance(runs, dict) or len(runs) > MAX_BACKGROUND_RUNS:
        raise ValueError("automation background runs are invalid or unbounded")
    if not isinstance(schedules, dict) or len(schedules) > MAX_SCHEDULES:
        raise ValueError("automation schedules are invalid or unbounded")
    if not isinstance(pending, dict) or len(pending) > MAX_PENDING_OCCURRENCES:
        raise ValueError("automation pending occurrences are invalid or unbounded")
    for key, run in runs.items():
        _text(key, "automation background key", 160)
        _validate_background_run(run)
        if run["runId"] != key:
            raise ValueError("automation background key binding mismatch")
    for key, schedule in schedules.items():
        _text(key, "automation schedule key", 160)
        _validate_schedule(schedule)
        if schedule["scheduleId"] != key:
            raise ValueError("automation schedule key binding mismatch")
    for key, occurrence in pending.items():
        _text(key, "automation occurrence key", 256)
        _validate_occurrence(occurrence)
        if occurrence["occurrenceId"] != key:
            raise ValueError("automation occurrence key binding mismatch")
    encoded = json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_AUTOMATION_STATE_BYTES:
        raise ValueError("automation state exceeds byte limit")
    return value


def _validate_existing_target(path: str) -> None:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("automation state target is not a regular file")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("automation state target permissions are not private")
    if metadata.st_size > MAX_AUTOMATION_STATE_BYTES:
        raise ValueError("automation state target exceeds byte limit")


def _read_unlocked(path: str) -> dict:
    _validate_existing_target(path)
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return _empty_state()
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > MAX_AUTOMATION_STATE_BYTES:
            raise ValueError("automation state changed to an unsafe file")
        chunks: list[bytes] = []
        remaining = MAX_AUTOMATION_STATE_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_AUTOMATION_STATE_BYTES:
        raise ValueError("automation state exceeds byte limit")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("automation state is corrupt") from exc
    return _validate_state(value)


def _write_unlocked(value: dict, path: str) -> None:
    _validate_state(value)
    encoded = (json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    if len(encoded) > MAX_AUTOMATION_STATE_BYTES:
        raise ValueError("automation state exceeds byte limit")
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    _validate_existing_target(path)
    directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
    basename = os.path.basename(path)
    temporary = os.path.join(directory, f".{basename}.tmp.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}")
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        offset = 0
        while offset < len(encoded):
            written = os.write(descriptor, encoded[offset:])
            if written <= 0:
                raise OSError("automation state write made no progress")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        os.chmod(path, 0o600, follow_symlinks=False)
        os.fsync(directory_fd)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    finally:
        os.close(directory_fd)


@contextmanager
def _file_lock(path: str, *, exclusive: bool):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    lock_path = f"{path}.lock"
    descriptor = os.open(
        lock_path,
        os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError("automation state lock is unsafe")
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def read_automation_state(path: str = DEFAULT_AUTOMATION_STATE_FILE) -> dict:
    with _STATE_LOCK:
        with _file_lock(path, exclusive=False):
            return _read_unlocked(path)


def _mutate(path: str, transform) -> bool:
    with _STATE_LOCK:
        with _file_lock(path, exclusive=True):
            current = _read_unlocked(path)
            changed, next_state = transform(current)
            if not changed:
                return False
            next_state["generation"] = current["generation"] + 1
            _write_unlocked(next_state, path)
            return True


def create_background_run(run: dict, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    run = _validate_background_run(run)
    def transform(current: dict):
        if run["runId"] in current["backgroundRuns"] or len(current["backgroundRuns"]) >= MAX_BACKGROUND_RUNS:
            return False, current
        next_state = json.loads(json.dumps(current))
        next_state["backgroundRuns"][run["runId"]] = run
        return True, next_state
    return _mutate(path, transform)


def compare_and_swap_background_run(run_id: str, expected_revision: int, next_run: dict, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    run_id = _text(run_id, "background run id", 160)
    expected_revision = _integer(expected_revision, "background expected revision", minimum=1)
    next_run = _validate_background_run(next_run)
    if next_run["runId"] != run_id or next_run["revision"] != expected_revision + 1:
        raise ValueError("background CAS next revision/binding is invalid")
    immutable = ("runId", "consumerId", "subjectId", "ownerKind", "ownerId", "spaceId", "projectId", "budgets", "createdAt", "deadlineAt")
    def transform(current: dict):
        existing = current["backgroundRuns"].get(run_id)
        if existing is None or existing["revision"] != expected_revision:
            return False, current
        if any(existing[key] != next_run[key] for key in immutable):
            raise ValueError("background CAS cannot mutate immutable identity")
        next_state = json.loads(json.dumps(current))
        next_state["backgroundRuns"][run_id] = next_run
        return True, next_state
    return _mutate(path, transform)


def create_schedule(schedule: dict, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    schedule = _validate_schedule(schedule)
    def transform(current: dict):
        if schedule["scheduleId"] in current["schedules"] or len(current["schedules"]) >= MAX_SCHEDULES:
            return False, current
        next_state = json.loads(json.dumps(current))
        next_state["schedules"][schedule["scheduleId"]] = schedule
        return True, next_state
    return _mutate(path, transform)


def _assert_schedule_identity(existing: dict, next_schedule: dict) -> None:
    immutable = ("scheduleId", "consumerId", "subjectId", "ownerKind", "ownerId", "spaceId", "projectId", "timezone", "recurrence", "maxRuns", "deduplicationKey", "createdAt")
    if any(existing[key] != next_schedule[key] for key in immutable):
        raise ValueError("schedule CAS cannot mutate immutable identity")


def compare_and_swap_schedule(schedule_id: str, expected_revision: int, next_schedule: dict, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    schedule_id = _text(schedule_id, "schedule id", 160)
    expected_revision = _integer(expected_revision, "schedule expected revision", minimum=1)
    next_schedule = _validate_schedule(next_schedule)
    if next_schedule["scheduleId"] != schedule_id or next_schedule["revision"] != expected_revision + 1:
        raise ValueError("schedule CAS next revision/binding is invalid")
    def transform(current: dict):
        existing = current["schedules"].get(schedule_id)
        if existing is None or existing["revision"] != expected_revision:
            return False, current
        _assert_schedule_identity(existing, next_schedule)
        next_state = json.loads(json.dumps(current))
        next_state["schedules"][schedule_id] = next_schedule
        return True, next_state
    return _mutate(path, transform)


def commit_schedule_occurrence(schedule_id: str, expected_revision: int, next_schedule: dict, occurrence: dict, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    schedule_id = _text(schedule_id, "schedule id", 160)
    expected_revision = _integer(expected_revision, "schedule expected revision", minimum=1)
    next_schedule = _validate_schedule(next_schedule)
    occurrence = _validate_occurrence(occurrence)
    if next_schedule["scheduleId"] != schedule_id or next_schedule["revision"] != expected_revision + 1:
        raise ValueError("schedule occurrence next revision/binding is invalid")
    if occurrence["scheduleId"] != schedule_id:
        raise ValueError("schedule occurrence binding is invalid")
    def transform(current: dict):
        existing = current["schedules"].get(schedule_id)
        if existing is None or existing["revision"] != expected_revision:
            return False, current
        if occurrence["occurrenceId"] in current["pendingOccurrences"] or len(current["pendingOccurrences"]) >= MAX_PENDING_OCCURRENCES:
            return False, current
        _assert_schedule_identity(existing, next_schedule)
        if occurrence["consumerId"] != existing["consumerId"] or occurrence["subjectId"] != existing["subjectId"]:
            raise ValueError("occurrence consumer/subject binding mismatch")
        if occurrence["sequence"] != existing["runCount"] + 1 or next_schedule["runCount"] != occurrence["sequence"]:
            raise ValueError("occurrence sequence is inconsistent")
        if next_schedule["lastRunAt"] != occurrence["dueAt"]:
            raise ValueError("occurrence due time must match schedule lastRunAt")
        next_state = json.loads(json.dumps(current))
        next_state["schedules"][schedule_id] = next_schedule
        next_state["pendingOccurrences"][occurrence["occurrenceId"]] = occurrence
        return True, next_state
    return _mutate(path, transform)


def ack_schedule_occurrence(occurrence_id: str, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> bool:
    occurrence_id = _text(occurrence_id, "occurrence id", 256)
    def transform(current: dict):
        if occurrence_id not in current["pendingOccurrences"]:
            return False, current
        next_state = json.loads(json.dumps(current))
        del next_state["pendingOccurrences"][occurrence_id]
        return True, next_state
    return _mutate(path, transform)
